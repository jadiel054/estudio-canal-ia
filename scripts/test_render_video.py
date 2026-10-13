import shutil
import sys
import tempfile
import unittest
import uuid
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

if __name__ == "__main__":
    unittest.main()
