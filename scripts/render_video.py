#!/usr/bin/env python3
"""Worker de produção audiovisual real; não acessa APIs externas além do Vercel e GitHub."""
from __future__ import annotations

import hashlib
import hmac
import http.client
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

BASE_URL = os.environ.get("STUDIO_BASE_URL", "https://estudio-canal-ia.vercel.app").rstrip("/")
SECRET = os.environ.get("STUDIO_RENDER_HMAC_SECRET", "")
JOB_ID = os.environ.get("RENDER_JOB_ID", "")
RUN_ID = int(os.environ.get("GITHUB_RUN_ID", "0"))
GH_TOKEN = os.environ.get("GH_TOKEN", "")
GH_API = "https://api.github.com/repos/jadiel054/estudio-canal-ia"
WORK = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"studio-render-{JOB_ID}"
MAX_OUTPUT_BYTES = 1_900_000_000

class RenderError(RuntimeError):
    pass

def compact_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

def sign_body(body: bytes, path: str) -> str:
    stamp = str(int(time.time()))
    canonical = f"{stamp}.POST.{path}.".encode("utf-8") + body
    digest = hmac.new(SECRET.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return f"t={stamp},v1={digest}"

def verify_body(body: bytes, signature: str | None, path: str) -> bool:
    if not signature:
        return False
    match = re.fullmatch(r"t=(\d{10}),v1=([a-f0-9]{64})", signature.strip())
    if not match:
        return False
    stamp = int(match.group(1))
    if abs(int(time.time()) - stamp) > 300:
        return False
    canonical = f"{stamp}.POST.{path}.".encode("utf-8") + body
    expected = hmac.new(SECRET.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, match.group(2))

def post_studio(path: str, body: bytes, *, response_type: str = "json", verify_signature: bool = False):
    request = urllib.request.Request(
        BASE_URL + path,
        data=body,
        method="POST",
        headers={"content-type": "application/json", "x-render-signature": sign_body(body, path)},
    )
    try:
        with urllib.request.urlopen(request, timeout=55) as response:
            data = response.read()
            signature = response.headers.get("X-Render-Response-Signature")
            if (response_type != "json" or verify_signature) and not verify_body(data, signature, path):
                raise RenderError("A assinatura HMAC da resposta do Estúdio é inválida.")
            if response_type == "json":
                return json.loads(data.decode("utf-8")), response.headers
            return data, response.headers
    except urllib.error.HTTPError as exc:
        # Não imprimir body: pode conter texto editorial do dono.
        raise RenderError(f"Endpoint interno do Estúdio recusou a operação (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RenderError("Falha de rede ao conectar ao endpoint interno do Estúdio.") from None

def gh_request(method: str, url: str, body: bytes | None = None, content_type: str = "application/vnd.github+json"):
    if not GH_TOKEN:
        raise RenderError("GITHUB_TOKEN de execução ausente.")
    request = urllib.request.Request(url, data=body, method=method, headers={
        "authorization": f"Bearer {GH_TOKEN}",
        "accept": "application/vnd.github+json",
        "content-type": content_type,
        "x-github-api-version": "2022-11-28",
        "user-agent": "estudio-canal-ia-render-worker",
    })
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = response.read()
            if not data:
                return None
            return json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RenderError(f"GitHub API recusou a etapa de Release (HTTP {exc.code}).") from None
    except (urllib.error.URLError, TimeoutError):
        raise RenderError("Falha de rede ao falar com GitHub Releases.") from None

def run(command: list[str], label: str):
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=900)
    except subprocess.TimeoutExpired as exc:
        raise RenderError(f"Tempo limite excedido ao {label}.") from exc
    except subprocess.CalledProcessError as exc:
        tail = (exc.stderr or "").strip().splitlines()[-1:] or ["erro do FFmpeg"]
        raise RenderError(f"Falha ao {label}: {tail[0][:180]}") from None

def ffprobe(path: Path) -> dict:
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", str(path)], check=True, capture_output=True, text=True, timeout=20)
        return json.loads(result.stdout)
    except Exception as exc:
        raise RenderError("Não foi possível inspecionar o MP4 final com ffprobe.") from exc

def font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()

def wrap_pixels(draw: ImageDraw.ImageDraw, text: str, selected_font: ImageFont.ImageFont, max_width: int, max_lines: int = 6) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and draw.textbbox((0, 0), candidate, font=selected_font)[2] > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textbbox((0, 0), lines[-1] + "…", font=selected_font)[2] > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip() + "…"
    return lines

def load_capture(data: bytes, content_type: str) -> Image.Image:
    import io
    try:
        image = Image.open(io.BytesIO(data))
        if image.format not in {"PNG", "JPEG", "WEBP"}:
            raise RenderError("Formato de captura inválido.")
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except RenderError:
        raise
    except Exception as exc:
        raise RenderError("Não foi possível ler uma captura enviada.") from exc

def make_slide(path: Path, manifest: dict, cue: dict, index: int, dims: tuple[int, int], capture: Image.Image | None):
    width, height = dims
    image = Image.new("RGB", dims, (10, 15, 27))
    draw = ImageDraw.Draw(image)
    scale = width / 1280
    pad = int(70 * scale)
    draw.rectangle((0, 0, width, int(10 * scale)), fill=(198, 255, 77))
    draw.text((pad, int(38 * scale)), "ESTÚDIO  /  TUTORIAL TÉCNICO", font=font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(17 * scale)), fill=(198, 255, 77))
    section = str(cue.get("section", "Narração"))[:70]
    section_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(25 * scale))
    draw.text((pad, int(82 * scale)), section, font=section_font, fill=(185, 196, 217))
    main_top = int(140 * scale)
    main_bottom = height - int(155 * scale)
    if capture is not None:
        frame = (pad, main_top, width - pad, main_top + int((main_bottom-main_top) * 0.67))
        draw.rounded_rectangle(frame, radius=int(18 * scale), fill=(22, 31, 49), outline=(69, 83, 107), width=max(2, int(2*scale)))
        max_size = (frame[2]-frame[0]-int(28*scale), frame[3]-frame[1]-int(28*scale))
        thumb = ImageOps.contain(capture, max_size, method=Image.Resampling.LANCZOS)
        image.paste(thumb, (frame[0] + (frame[2]-frame[0]-thumb.width)//2, frame[1] + (frame[3]-frame[1]-thumb.height)//2))
        draw = ImageDraw.Draw(image)
        text_y = frame[3] + int(24 * scale)
    else:
        text_y = main_top + int(20 * scale)
    body_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int((46 if width > height else 56) * scale))
    cue_text = str(cue.get("text", "")).strip()
    lines = wrap_pixels(draw, cue_text, body_font, width - 2*pad, max_lines=5)
    line_h = int(body_font.size * 1.22)
    for line in lines:
        draw.text((pad, text_y), line, font=body_font, fill=(245, 247, 252))
        text_y += line_h
    code_blocks = manifest.get("codeBlocks") or []
    if code_blocks:
        code = str(code_blocks[index % len(code_blocks)]).splitlines()[:6]
        code_y = min(text_y + int(18*scale), height - int(105*scale))
        mono = font("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", int(18 * scale))
        box = (pad, code_y, width-pad, min(height-int(72*scale), code_y+int((len(code)+1)*29*scale)))
        if box[3] > box[1]:
            draw.rounded_rectangle(box, radius=int(12*scale), fill=(17, 25, 40), outline=(53, 71, 91), width=max(1, int(scale)))
            for line_index, code_line in enumerate(code):
                draw.text((box[0]+int(18*scale), box[1]+int(10*scale)+line_index*int(27*scale)), code_line[:100], font=mono, fill=(174, 195, 224))
    draw.line((pad, height-int(54*scale), width-pad, height-int(54*scale)), fill=(42, 53, 72), width=max(1, int(scale)))
    footer = f"{index+1:02d}  ·  {manifest.get('format','Vídeo')}  ·  Material visual do roteiro/capturas enviadas"
    draw.text((pad, height-int(40*scale)), footer, font=font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", int(13*scale)), fill=(132, 146, 169))
    image.save(path, format="PNG", optimize=True)

def srt_time(seconds: float) -> str:
    millis = max(0, int(round(seconds * 1000)))
    hours, rem = divmod(millis, 3_600_000); minutes, rem = divmod(rem, 60_000); secs, ms = divmod(rem, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"

def build_srt(entries: list[tuple[float, float, str]], path: Path):
    blocks = []
    for number, (start, end, text) in enumerate(entries, 1):
        blocks.append(f"{number}\n{srt_time(start)} --> {srt_time(max(start+0.25, end))}\n{text.replace(chr(10), ' ').strip()}\n")
    path.write_text("\n".join(blocks), encoding="utf-8")

def callback(manifest: dict, status: str, progress: int, *, message: str | None = None, result: dict | None = None):
    payload = {"eventId": str(uuid.uuid4()), "jobId": manifest["jobId"], "workflowRunId": RUN_ID, "status": status, "progress": progress}
    if message:
        payload["message"] = message[:350]
    if result:
        payload.update(result)
    body = compact_json(payload)
    response, _ = post_studio("/api/render?op=callback", body)
    if not response.get("ok"):
        raise RenderError("O Estúdio não confirmou o callback do job.")
    return response

def fetch_manifest() -> dict:
    body = compact_json({"jobId": JOB_ID})
    response, _ = post_studio("/api/render?op=manifest", body, verify_signature=True)
    manifest = response
    if manifest.get("jobId") != JOB_ID or not manifest.get("cues") or len(manifest["cues"]) > 80:
        raise RenderError("O manifesto não corresponde ao job ou não contém cues válidos.")
    return manifest

def fetch_voice(job_id: str, cue_index: int, output: Path) -> float:
    body = compact_json({"jobId": job_id, "cueIndex": cue_index})
    audio, headers = post_studio("/api/render?op=voice", body, response_type="binary")
    if len(audio) < 64 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RenderError("O adaptador TTS não retornou WAV válido.")
    output.write_bytes(audio)
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(output)], check=True, capture_output=True, text=True, timeout=20)
    duration = float(result.stdout.strip())
    if not 0.2 <= duration <= 120:
        raise RenderError("Duração de um trecho TTS fora do limite seguro.")
    return duration

def fetch_inputs(manifest: dict, directory: Path) -> list[Image.Image]:
    images = []
    for item in manifest.get("inputs", []):
        if len(images) >= 5:
            break
        body = compact_json({"jobId": manifest["jobId"], "inputAssetId": item["id"]})
        data, headers = post_studio("/api/render?op=input", body, response_type="binary")
        digest = hashlib.sha256(data).hexdigest()
        if not hmac.compare_digest(digest, item["sha256"]) or len(data) != int(item["sizeBytes"]):
            raise RenderError("A captura transferida não corresponde ao hash e ao tamanho do manifesto.")
        path = directory / f"capture-{len(images):02d}.img"
        path.write_bytes(data)
        image = load_capture(data, item["contentType"])
        images.append(image)
    return images

def make_music_track(duration: float, output: Path):
    duration = max(duration, 2.0)
    expr = "0.055*sin(2*PI*174.61*t)+0.045*sin(2*PI*220.00*t)+0.035*sin(2*PI*261.63*t)+0.025*sin(2*PI*329.63*t)"
    audio_src = f"aevalsrc={expr}:s=48000:d={duration:.3f}"
    fade_out = max(0.0, duration-2.0)
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", audio_src, "-af", f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_out:.3f}:d=2,volume=0.7", "-c:a", "pcm_s16le", str(output)], "gerar trilha instrumental sintética")

def create_video(manifest: dict, directory: Path) -> tuple[Path, Path, float]:
    cues = manifest["cues"]
    if manifest.get("format") == "Short":
        dimensions = (1080, 1920)
    else:
        dimensions = (1280, 720)
    captures = fetch_inputs(manifest, directory)
    slides: list[Path] = []
    subtitles: list[tuple[float, float, str]] = []
    audio_files: list[Path] = []
    durations: list[float] = []
    time_cursor = 0.0
    is_tts = manifest.get("voiceMode") == "TTS"
    for index, cue in enumerate(cues):
        if is_tts:
            audio_path = directory / f"voice-{index:03d}.wav"
            speech_duration = fetch_voice(manifest["jobId"], int(cue["index"]), audio_path)
            audio_files.append(audio_path)
            segment_duration = speech_duration + 0.25
            subtitles.append((time_cursor, time_cursor + speech_duration, str(cue["text"])))
        else:
            segment_duration = min(14.0, max(3.5, len(str(cue["text"])) / 14.0 + 1.5))
            subtitles.append((time_cursor, time_cursor + segment_duration, str(cue["text"])))
        durations.append(segment_duration)
        slide = directory / f"slide-{index:03d}.png"
        capture = captures[index % len(captures)] if captures else None
        make_slide(slide, manifest, cue, index, dimensions, capture)
        slides.append(slide)
        time_cursor += segment_duration
        if is_tts and ((index + 1) % 5 == 0 or index == len(cues)-1):
            callback(manifest, "rendering", min(55, 8 + int(45 * (index+1) / len(cues))))
    if not is_tts:
        callback(manifest, "rendering", 50)

    srt_path = directory / "captions.srt"
    build_srt(subtitles, srt_path)
    concat_path = directory / "slides.txt"
    lines = []
    for slide, duration in zip(slides, durations):
        escaped = str(slide).replace("'", "'\\''")
        lines.extend([f"file '{escaped}'", f"duration {duration:.4f}"])
    escaped_last = str(slides[-1]).replace("'", "'\\''")
    lines.append(f"file '{escaped_last}'")
    concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    scene_video = directory / "scenes.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path), "-fps_mode", "cfr", "-r", "30", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "25", "-pix_fmt", "yuv420p", "-an", str(scene_video)], "compor cenas")

    audio_path = directory / "program.wav"
    if is_tts:
        inputs = []; filters = []
        for idx, audio_file in enumerate(audio_files):
            inputs.extend(["-i", str(audio_file)])
            filters.append(f"[{idx}:a]aformat=sample_fmts=fltp:sample_rates=24000:channel_layouts=mono,apad=pad_dur=0.25,asetpts=PTS-STARTPTS[a{idx}]")
        joined = "".join(f"[a{idx}]" for idx in range(len(audio_files)))
        filters.append(f"{joined}concat=n={len(audio_files)}:v=0:a=1[out]")
        run(["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filters), "-map", "[out]", "-c:a", "pcm_s16le", str(audio_path)], "unir narração")
    else:
        make_music_track(time_cursor, audio_path)

    filename = f"estudio-{JOB_ID}.mp4"
    final_path = directory / filename
    subtitle_filter = f"subtitles=filename='{srt_path}':fontsdir='/usr/share/fonts/truetype/dejavu':force_style='FontName=DejaVu Sans,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H00100000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=24'"
    run(["ffmpeg", "-y", "-i", str(scene_video), "-i", str(audio_path), "-vf", subtitle_filter, "-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(final_path)], "renderizar MP4 e queimar legendas")
    return final_path, srt_path, time_cursor

def qa_result(path: Path, srt_path: Path, probed: dict, manifest: dict) -> tuple[list[dict], float, int]:
    streams = probed.get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    duration = float(probed.get("format", {}).get("duration", 0) or 0)
    size = path.stat().st_size
    expected_dims = (1080, 1920) if manifest.get("format") == "Short" else (1280, 720)
    captions = srt_path.read_text(encoding="utf-8").strip()
    short_limit = manifest.get("format") != "Short" or duration <= 180
    checks = [
        {"label": "video_stream", "passed": bool(video and video.get("codec_name") == "h264" and (video.get("width"), video.get("height")) == expected_dims), "verified": True, "note": f"H.264 {video.get('width')}x{video.get('height')}" if video else "Stream de vídeo ausente"},
        {"label": "audio_stream", "passed": bool(audio and audio.get("codec_name") == "aac"), "verified": True, "note": f"Áudio {audio.get('codec_name')}" if audio else "Stream de áudio ausente"},
        {"label": "captions", "passed": bool(captions and "-->" in captions and len(captions.split("-->")) >= 2), "verified": True, "note": f"SRT com {len(manifest['cues'])} cues; legendas queimadas no MP4"},
        {"label": "duration", "passed": 0 < duration <= 7200 and short_limit, "verified": True, "note": f"Duração medida por ffprobe: {duration:.2f}s"},
        {"label": "file_size", "passed": 10_000 < size <= MAX_OUTPUT_BYTES, "verified": True, "note": f"Arquivo verificado: {size} bytes"},
    ]
    return checks, duration, size

def create_release_and_upload(video: Path, captions: Path, manifest: dict) -> tuple[int, int]:
    tag = f"studio-render-{manifest['jobId']}"
    release = gh_request("POST", GH_API + "/releases", compact_json({"tag_name": tag, "name": f"Render privado · {manifest['title'][:100]}", "body": "Asset temporário do Estúdio. Release em rascunho; não publicado.", "draft": True, "prerelease": True, "generate_release_notes": False}))
    if not release or not release.get("id"):
        raise RenderError("GitHub não criou um draft Release para o MP4.")
    upload_base = str(release.get("upload_url", "")).split("{", 1)[0]
    if not upload_base:
        raise RenderError("GitHub Release não forneceu URL de upload.")
    video_asset = upload_release_asset(upload_base + "?name=" + urllib.parse.quote(video.name), video, "video/mp4")
    # O SRT acompanha o MP4 para edição posterior; o app usa o asset de vídeo principal.
    upload_release_asset(upload_base + "?name=" + urllib.parse.quote(f"{manifest['jobId']}.srt"), captions, "text/plain")
    if not video_asset or not video_asset.get("id"):
        raise RenderError("O draft Release não confirmou o asset MP4.")
    return int(release["id"]), int(video_asset["id"])

def upload_release_asset(url: str, path: Path, content_type: str) -> dict:
    parts = urllib.parse.urlsplit(url)
    connection = http.client.HTTPSConnection(parts.netloc, timeout=120)
    request_path = parts.path + ("?" + parts.query if parts.query else "")
    try:
        connection.putrequest("POST", request_path)
        connection.putheader("authorization", f"Bearer {GH_TOKEN}")
        connection.putheader("accept", "application/vnd.github+json")
        connection.putheader("content-type", content_type)
        connection.putheader("content-length", str(path.stat().st_size))
        connection.putheader("x-github-api-version", "2022-11-28")
        connection.putheader("user-agent", "estudio-canal-ia-render-worker")
        connection.endheaders()
        with path.open("rb") as file:
            while chunk := file.read(8 * 1024 * 1024):
                connection.send(chunk)
        response = connection.getresponse()
        payload = response.read(2 * 1024 * 1024)
        if response.status < 200 or response.status >= 300:
            raise RenderError(f"GitHub recusou o upload de asset (HTTP {response.status}).")
        return json.loads(payload.decode("utf-8"))
    except (OSError, http.client.HTTPException, TimeoutError):
        raise RenderError("Falha de rede ao enviar asset ao GitHub Release.") from None
    finally:
        connection.close()

def main():
    if not SECRET or len(SECRET) < 32 or not re.fullmatch(r"[0-9a-f-]{36}", JOB_ID, re.I) or RUN_ID < 1:
        raise RenderError("Configuração de execução incompleta; nada foi enviado.")
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = fetch_manifest()
    callback(manifest, "rendering", 3)
    video, captions, duration = create_video(manifest, WORK)
    probed = ffprobe(video)
    checks, duration, size = qa_result(video, captions, probed, manifest)
    if size > MAX_OUTPUT_BYTES:
        callback(manifest, "failed", 90, message="O MP4 excedeu o limite de 1,9 GB; ajuste a duração ou o formato.")
        raise RenderError("MP4 maior que o limite permitido para o Release.")
    callback(manifest, "rendering", 88)
    release_id, asset_id = create_release_and_upload(video, captions, manifest)
    result = {"releaseId": release_id, "assetId": asset_id, "fileName": video.name, "fileSizeBytes": size, "durationSeconds": round(duration, 3), "qa": checks}
    response = callback(manifest, "qa", 95, result=result)
    if response.get("status") != "succeeded":
        raise RenderError("O QA do Estúdio não aprovou o MP4; o Portão 2 continua bloqueado.")
    print(f"Render concluído. job={JOB_ID} release={release_id} asset={asset_id} duração={duration:.2f}s tamanho={size} bytes")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # A mensagem é limitada e não inclui roteiro, conteúdo dos arquivos nem segredos.
        message = str(exc)[:350] if isinstance(exc, RenderError) else "Falha inesperada no worker; consulte o log técnico da etapa sem compartilhar segredos."
        try:
            if JOB_ID and SECRET and RUN_ID:
                fallback = {"jobId": JOB_ID, "cues": [], "title": "Render"}
                callback(fallback, "failed", 90, message=message)
        except Exception:
            pass
        print(message, file=sys.stderr)
        sys.exit(1)
