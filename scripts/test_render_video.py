import io
import json
import shutil
import sys
import tempfile
import unittest
import urllib.error
import uuid
from email.message import Message
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import render_video as worker

class RenderWorkerTests(unittest.TestCase):
    def setUp(self):
        self.secret = "a" * 48
        worker.SECRET = self.secret

    def test_hmac_verifies_exact_body_and_path(self):
        body = b'{"jobId":"abc"}'
        signature = worker.sign_body(body, "/api/render?op=manifest")
        self.assertTrue(worker.verify_body(body, signature, "/api/render?op=manifest"))
        self.assertFalse(worker.verify_body(body + b" ", signature, "/api/render?op=manifest"))
        self.assertFalse(worker.verify_body(body, signature, "/api/render?op=voice"))

    def test_hmac_rejects_expired_signature(self):
        body = b"{}"
        with patch.object(worker.time, "time", return_value=1_900_000_000):
            signature = worker.sign_body(body, "/api/render?op=callback")
        with patch.object(worker.time, "time", return_value=1_900_000_400):
            self.assertFalse(worker.verify_body(body, signature, "/api/render?op=callback"))

    def test_operation_parser_and_safe_error_code_allowlist(self):
        self.assertEqual(worker.operation_from_path("/api/render?op=voice"), "voice")
        self.assertEqual(worker.operation_from_path("/api/render?op=token-secret"), "unknown")
        self.assertEqual(worker.RenderError("falha local", operation="render", error_code="ffmpeg_failed").error_code, "ffmpeg_failed")
        headers = Message()
        headers["X-Render-Error-Code"] = "tts_timeout"
        self.assertEqual(worker.safe_error_code(headers), "tts_timeout")
        unsafe_headers = Message()
        unsafe_headers["X-Render-Error-Code"] = "mensagem com segredo"
        self.assertEqual(worker.safe_error_code(unsafe_headers), "render_http_error")

    def test_quota_metadata_is_allowlisted_and_bounded(self):
        headers = Message()
        headers["X-Render-Quota-Scope"] = "rpd"
        headers["X-Render-Quota-Value"] = "25"
        headers["X-Render-Quota-Metric"] = "generativelanguage.googleapis.com/requests_per_day"
        headers["X-Render-Quota-Id"] = "tts_requests"
        headers["X-Render-Retry-After-Ms"] = "86400000"
        headers["X-Render-TTS-Model"] = "gemini-3.8-flash-tts"
        response_error = urllib.error.HTTPError("https://estudio.example/api/render?op=voice", 400, "Bad Request", headers, io.BytesIO(b'{"private":"ignored"}'))
        with patch.object(worker.urllib.request, "urlopen", side_effect=response_error):
            with self.assertRaises(worker.RenderError) as caught:
                worker.post_studio("/api/render?op=voice", b"{}")
        error = caught.exception
        self.assertEqual((error.quota_scope, error.quota_value, error.quota_metric, error.quota_id, error.retry_after_ms, error.provider_model),
                         ("rpd", 25.0, "generativelanguage.googleapis.com/requests_per_day", "tts_requests", 86_400_000, "gemini-3.8-flash-tts"))
        self.assertEqual(response_error.fp.tell(), 0)
        self.assertIsNone(worker.safe_quota_identifier("quota description: private script"))
        self.assertIsNone(worker.safe_quota_value(float("inf")))
        self.assertIsNone(worker.safe_retry_after(604_800_001))

    def test_tts_chunks_cover_cues_once_in_order(self):
        manifest = {
            "cues": [{"index": 0, "text": "Primeira frase."}, {"index": 1, "text": "Segunda frase."}, {"index": 2, "text": "Terceira."}],
            "ttsChunks": [
                {"index": 0, "cueIndices": [0, 1], "text": "Primeira frase. Segunda frase."},
                {"index": 1, "cueIndices": [2], "text": "Terceira."},
            ],
        }
        mapping = worker.validate_tts_chunks(manifest)
        self.assertEqual([mapping[index]["index"] for index in range(3)], [0, 0, 1])
        invalid = json.loads(json.dumps(manifest))
        invalid["ttsChunks"][1]["cueIndices"] = [0]
        with self.assertRaises(worker.RenderError):
            worker.validate_tts_chunks(invalid)

    def test_caption_timing_uses_text_weights_and_nearby_silence(self):
        self.assertEqual(worker.allocate_cue_timings(["A", "BBB"], 8.0), [(0.0, 2.0), (2.0, 8.0)])
        self.assertEqual(worker.allocate_cue_timings(["Olá um", "Olá dois"], 10.0, [(4.7, 5.3)]), [(0.0, 4.7), (5.3, 10.0)])
        self.assertEqual(worker.allocate_cue_timings(["A", "BBB"], 8.0, [(5.5, 6.0)]), [(0.0, 2.0), (2.0, 8.0)])
        timings = worker.allocate_cue_timings(["A", "A", "A", "A", "A"], 5.0, [(0.7, 2.5)])
        self.assertTrue(all(start <= end for start, end in timings))
        self.assertTrue(all(timings[index][0] <= timings[index + 1][0] for index in range(len(timings) - 1)))

    def test_silence_detection_parses_only_timestamps(self):
        output = type("Probe", (), {"returncode": 0, "stderr": "[silencedetect] silence_start: 1.25\n[silencedetect] silence_end: 1.60 | silence_duration: 0.35\n"})()
        with patch.object(worker.subprocess, "run", return_value=output):
            self.assertEqual(worker.detect_silence_intervals(Path("fixture.wav")), [(1.25, 1.6)])

    def test_worker_pauses_between_tts_chunks_only(self):
        with patch.object(worker.time, "sleep") as sleep:
            worker.pause_before_tts_chunk(0)
            worker.pause_before_tts_chunk(1)
        sleep.assert_called_once_with(1.0)

    def test_fetch_voice_requests_chunk_index_and_validates_audio(self):
        wav = b"RIFF" + (56).to_bytes(4, "little") + b"WAVE" + b"\x00" * 56
        sent = {}
        def fake_post(path, body, response_type="json", **kwargs):
            sent.update(path=path, body=json.loads(body), response_type=response_type)
            return wav, {}
        probe = type("Probe", (), {"stdout": "3.5"})()
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, "post_studio", side_effect=fake_post), patch.object(worker.subprocess, "run", return_value=probe):
            output = Path(tmp) / "chunk.wav"
            duration = worker.fetch_voice("job-123", 4, output)
            self.assertEqual(duration, 3.5)
            self.assertEqual(sent, {"path": "/api/render?op=voice", "body": {"jobId": "job-123", "chunkIndex": 4}, "response_type": "binary"})
            self.assertEqual(output.read_bytes(), wav)

    def test_http_error_keeps_only_operation_code_and_status(self):
        headers = Message()
        headers["X-Render-Error-Code"] = "tts_timeout"
        headers["X-Render-Stage-Code"] = "verificacao_release_consulta"
        headers["X-Render-Upstream-Status"] = "429"
        headers["X-Render-Quota-Scope"] = "rpd"
        headers["X-Render-Quota-Value"] = "25"
        headers["X-Render-Quota-Metric"] = "generativelanguage.googleapis.com/requests_per_day"
        headers["X-Render-Quota-Id"] = "tts_requests"
        headers["X-Render-Retry-After-Ms"] = "86400000"
        headers["X-Render-TTS-Model"] = "gemini-3.8-flash-tts"
        private_body = b'{"message":"roteiro confidencial e chave privada"}'
        response_error = urllib.error.HTTPError(
            "https://estudio.example/api/render?op=voice", 400, "Bad Request", headers, io.BytesIO(private_body)
        )
        with patch.object(worker.urllib.request, "urlopen", side_effect=response_error):
            with self.assertRaises(worker.RenderError) as caught:
                worker.post_studio("/api/render?op=voice", b"{}")
        error = caught.exception
        self.assertEqual((error.operation, error.error_code, error.http_status, error.upstream_status), ("voice", "tts_timeout", 400, 429))
        self.assertEqual(error.stage_code, "verificacao_release_consulta")
        self.assertEqual((error.quota_scope, error.quota_value, error.retry_after_ms, error.provider_model), ("rpd", 25.0, 86_400_000, "gemini-3.8-flash-tts"))
        self.assertNotIn("roteiro confidencial", str(error))
        self.assertNotIn("chave privada", str(error))
        self.assertEqual(response_error.fp.tell(), 0, "O body da resposta não deve ser lido pelo worker")

    def test_stage_code_allowlist_rejects_free_text(self):
        headers = Message()
        headers["X-Render-Stage-Code"] = "update_banco"
        self.assertEqual(worker.safe_callback_stage_code(headers), "update_banco")
        malicious_headers = Message()
        malicious_headers["X-Render-Stage-Code"] = "roteiro privado e segredo"
        self.assertIsNone(worker.safe_callback_stage_code(malicious_headers))

    def test_failed_callback_sends_only_safe_diagnostic_fields(self):
        old_run_id = worker.RUN_ID
        worker.RUN_ID = 77
        sent = {}
        def fake_post(path, body):
            sent["path"] = path
            sent["payload"] = json.loads(body)
            return {"ok": True}, {}
        try:
            with patch.object(worker, "post_studio", side_effect=fake_post):
                worker.callback(
                    {"jobId": str(uuid.uuid4())}, "failed", 90,
                    message="roteiro confidencial não deve ser enviado",
                    diagnostic=worker.RenderError("mensagem privada", operation="voice", error_code="tts_quota_daily", http_status=400, upstream_status=429, quota_scope="rpd", quota_value=25, quota_metric="generativelanguage.googleapis.com/requests_per_day", quota_id="tts_requests", retry_after_ms=86_400_000, provider_model="gemini-3.8-flash-tts"),
                )
        finally:
            worker.RUN_ID = old_run_id
        payload = sent["payload"]
        self.assertEqual(sent["path"], "/api/render?op=callback")
        self.assertEqual((payload["errorOperation"], payload["errorCode"], payload["httpStatus"]), ("voice", "tts_quota_daily", 400))
        self.assertEqual((payload["quotaScope"], payload["quotaValue"], payload["quotaMetric"], payload["retryAfterMs"], payload["providerModel"]), ("rpd", 25.0, "generativelanguage.googleapis.com/requests_per_day", 86_400_000, "gemini-3.8-flash-tts"))
        self.assertNotIn("message", payload)
        self.assertNotIn("roteiro confidencial", json.dumps(payload))
        self.assertNotIn("mensagem privada", json.dumps(payload))

    def test_srt_timestamp_and_cue_output(self):
        self.assertEqual(worker.srt_time(61.25), "00:01:01,250")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "captions.srt"
            worker.build_srt([(0, 2.5, "Texto de teste")], path)
            self.assertIn("00:00:00,000 --> 00:00:02,500", path.read_text(encoding="utf-8"))

    def test_slide_is_rendered_at_target_dimensions(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "slide.png"
            manifest = {"format": "Short", "codeBlocks": ["print('oi')"]}
            cue = {"section": "Demonstração", "text": "Este é um teste de composição de captura e código."}
            capture = Image.new("RGB", (800, 600), (30, 90, 120))
            worker.make_slide(path, manifest, cue, 0, (1080, 1920), capture)
            with Image.open(path) as image:
                self.assertEqual(image.size, (1080, 1920))

    def test_qa_checks_real_streams_captions_and_short_length(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "final.mp4"
            captions = Path(directory) / "captions.srt"
            video.write_bytes(b"x" * 20_000)
            captions.write_text("1\n00:00:00,000 --> 00:00:02,000\nOlá\n", encoding="utf-8")
            manifest = {"format": "Short", "cues": [{"text": "Olá"}]}
            streams = [
                {"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920},
                {"codec_type": "audio", "codec_name": "aac", "sample_rate": "48000"},
            ]
            checks, duration, size = worker.qa_result(video, captions, {"streams": streams, "format": {"duration": "15.2"}}, manifest)
            self.assertTrue(all(check["passed"] and check["verified"] for check in checks))
            self.assertEqual(duration, 15.2)
            self.assertEqual(size, 20_000)

    def test_qa_fails_a_short_over_180_seconds(self):
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "final.mp4"
            captions = Path(directory) / "captions.srt"
            video.write_bytes(b"x" * 20_000)
            captions.write_text("1\n00:00:00,000 --> 00:04:00,000\nOlá\n", encoding="utf-8")
            manifest = {"format": "Short", "cues": [{"text": "Olá"}]}
            streams = [{"codec_type": "video", "codec_name": "h264", "width": 1080, "height": 1920}, {"codec_type": "audio", "codec_name": "aac"}]
            checks, _, _ = worker.qa_result(video, captions, {"streams": streams, "format": {"duration": "181"}}, manifest)
            self.assertFalse(next(check for check in checks if check["label"] == "duration")["passed"])

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe não instalados")
    def test_local_short_render_smoke_outputs_real_mp4(self):
        previous_job = worker.JOB_ID
        previous_callback = worker.callback
        job_id = str(uuid.uuid4())
        worker.JOB_ID = job_id
        worker.callback = lambda *args, **kwargs: {"ok": True}
        manifest = {
            "jobId": job_id,
            "title": "Fixture local de integração",
            "format": "Short",
            "voiceMode": "Música + texto",
            "cues": [{"index": 0, "section": "Smoke test", "text": "Composição local, sem dados do usuário ou serviços externos."}],
            "codeBlocks": ["print('smoke test')"],
            "inputs": [],
        }
        try:
            with tempfile.TemporaryDirectory(prefix="estudio-render-test-") as directory:
                video, captions, _ = worker.create_video(manifest, Path(directory))
                probe = worker.ffprobe(video)
                checks, duration, size = worker.qa_result(video, captions, probe, manifest)
                self.assertTrue(video.is_file())
                self.assertGreater(duration, 0)
                self.assertGreater(size, 10_000)
                self.assertTrue(all(check["passed"] and check["verified"] for check in checks), checks)
        finally:
            worker.JOB_ID = previous_job
            worker.callback = previous_callback

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe não instalados")
    def test_local_tts_render_smoke_uses_audio_fixture_without_external_api(self):
        previous_job = worker.JOB_ID
        previous_callback = worker.callback
        job_id = str(uuid.uuid4())
        worker.JOB_ID = job_id
        worker.callback = lambda *args, **kwargs: {"ok": True}
        manifest = {
            "jobId": job_id,
            "title": "Fixture local de TTS",
            "format": "Short",
            "voiceMode": "TTS",
            "cues": [{"index": 0, "section": "Teste", "text": "Primeira legenda do fixture."}, {"index": 1, "section": "Teste", "text": "Segunda legenda do fixture."}],
            "ttsChunks": [{"index": 0, "cueIndices": [0], "text": "Primeira legenda do fixture."}, {"index": 1, "cueIndices": [1], "text": "Segunda legenda do fixture."}],
            "codeBlocks": [],
            "inputs": [],
        }
        try:
            with tempfile.TemporaryDirectory(prefix="estudio-tts-fixture-") as directory:
                root = Path(directory)
                fixture = root / "fixture.wav"
                subprocess_result = worker.subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", str(fixture)], check=True, stdout=worker.subprocess.DEVNULL, stderr=worker.subprocess.PIPE, text=True, timeout=30)
                self.assertEqual(subprocess_result.returncode, 0)
                render_dir = root / "render"
                render_dir.mkdir()
                def fixture_voice(_job_id, _chunk_index, output):
                    shutil.copyfile(fixture, output)
                    return float(worker.ffprobe(output)["format"]["duration"])
                with patch.object(worker, "fetch_voice", side_effect=fixture_voice), patch.object(worker, "pause_before_tts_chunk") as pause:
                    video, captions, _ = worker.create_video(manifest, render_dir)
                    self.assertEqual([call.args for call in pause.call_args_list], [(0,), (1,)])
                probe = worker.ffprobe(video)
                checks, duration, size = worker.qa_result(video, captions, probe, manifest)
                caption_check = next(check for check in checks if check["label"] == "captions")
                self.assertTrue(video.is_file())
                self.assertGreater(duration, 0)
                self.assertGreater(size, 10_000)
                self.assertTrue(all(check["passed"] and check["verified"] for check in checks), checks)
                self.assertIn("sincronismo aproximado", caption_check["note"])
                self.assertEqual(captions.read_text(encoding="utf-8").count("-->"), 2)
        finally:
            worker.JOB_ID = previous_job
            worker.callback = previous_callback

if __name__ == "__main__":
    unittest.main()
