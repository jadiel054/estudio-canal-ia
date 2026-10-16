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
TTS_CHUNK_PAUSE_SECONDS = 1.0

RENDER_OPERATIONS = {"manifest", "voice", "input", "callback", "render", "qa", "release", "dispatch", "worker", "unknown"}
SAFE_RENDER_ERROR_CODES = {
    "render_unauthorized", "render_operation_not_found", "invalid_json_body", "invalid_job_id",
    "invalid_voice_request", "invalid_input_request", "tts_invalid_key", "tts_unavailable", "tts_quota_daily", "tts_quota_minute", "tts_quota_unknown",
    "tts_invalid_audio", "tts_network", "tts_timeout", "manifest_operation_failed",
    "voice_operation_failed", "input_operation_failed", "callback_operation_failed", "render_failed",
    "qa_failed", "release_failed", "dispatch_failed", "worker_unexpected", "render_network_error",
    "ffmpeg_failed",
    "invalid_response_signature", "invalid_tts_wav", "invalid_tts_duration", "manifest_invalid",
    "callback_not_confirmed", "github_api_failed", "github_upload_failed", "render_http_error",
    "callback_signature_invalid", "callback_payload_invalid", "callback_idempotency_failed",
    "callback_job_state_rejected", "callback_release_verification_failed", "callback_database_update_failed",
}
SAFE_CALLBACK_STAGE_CODES = {
    "assinatura", "validacao_payload", "idempotencia", "estado_job", "verificacao_release", "update_banco",
    "verificacao_release_metadados", "verificacao_release_consulta", "verificacao_release_resposta", "verificacao_release_estado",
    "verificacao_assets_consulta", "verificacao_assets_resposta", "verificacao_asset_ausente", "verificacao_asset_estado",
    "verificacao_asset_nome", "verificacao_asset_tamanho", "verificacao_asset_tipo",
}

def operation_from_path(path: str) -> str:
    operation = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query).get("op", ["unknown"])[0]
    return operation if operation in RENDER_OPERATIONS else "unknown"

def safe_error_code(headers) -> str:
    candidate = headers.get("X-Render-Error-Code") if headers else None
    return candidate if candidate in SAFE_RENDER_ERROR_CODES else "render_http_error"

def safe_callback_stage_code(headers) -> str | None:
    candidate = headers.get("X-Render-Stage-Code") if headers else None
    return candidate if candidate in SAFE_CALLBACK_STAGE_CODES else None

def safe_http_status(value) -> int | None:
    try:
        status = int(value)
    except (TypeError, ValueError):
        return None
    return status if 100 <= status <= 599 else None

SAFE_QUOTA_SCOPES = {"rpm", "tpm", "rpd", "tpd", "unknown"}
SAFE_TTS_MODELS = {"gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"}
def safe_quota_scope(value) -> str | None:
    return value if value in SAFE_QUOTA_SCOPES else None
def safe_quota_value(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= 1_000_000_000_000 else None
def safe_quota_identifier(value) -> str | None:
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_./:-]{1,120}", value) else None
def safe_retry_after(value) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if 0 <= number <= 604_800_000 else None

class RenderError(RuntimeError):
    def __init__(self, message: str, *, operation: str = "worker", error_code: str = "render_failed", http_status: int | None = None, upstream_status: int | None = None, quota_scope: str | None = None, quota_value: float | None = None, quota_metric: str | None = None, quota_id: str | None = None, retry_after_ms: int | None = None, provider_model: str | None = None, stage_code: str | None = None):
        super().__init__(message)
        self.operation = operation if operation in RENDER_OPERATIONS else "worker"
        self.error_code = error_code if error_code in SAFE_RENDER_ERROR_CODES else "render_failed"
        self.http_status = safe_http_status(http_status)
        self.upstream_status = safe_http_status(upstream_status)
        self.quota_scope = safe_quota_scope(quota_scope)
        self.quota_value = safe_quota_value(quota_value)
        self.quota_metric = safe_quota_identifier(quota_metric)
        self.quota_id = safe_quota_identifier(quota_id)
        self.retry_after_ms = safe_retry_after(retry_after_ms)
        self.provider_model = provider_model if provider_model in SAFE_TTS_MODELS else None
        self.stage_code = stage_code if stage_code in SAFE_CALLBACK_STAGE_CODES else None

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
    operation = operation_from_path(path)
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
                raise RenderError("A assinatura HMAC da resposta do Estúdio é inválida.", operation=operation, error_code="invalid_response_signature")
            if response_type == "json":
                try:
                    return json.loads(data.decode("utf-8")), response.headers
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise RenderError("Resposta JSON inválida do Estúdio.", operation=operation, error_code="render_http_error") from None
            return data, response.headers
    except urllib.error.HTTPError as exc:
        # Não ler/imprimir o body: a resposta pode conter texto editorial ou dados sensíveis.
        headers = exc.headers
        raise RenderError("Endpoint interno do Estúdio recusou a operação.", operation=operation, error_code=safe_error_code(headers), http_status=exc.code,
            upstream_status=safe_http_status(headers.get("X-Render-Upstream-Status") if headers else None),
            quota_scope=safe_quota_scope(headers.get("X-Render-Quota-Scope") if headers else None),
            quota_value=safe_quota_value(headers.get("X-Render-Quota-Value") if headers else None),
            quota_metric=safe_quota_identifier(headers.get("X-Render-Quota-Metric") if headers else None),
            quota_id=safe_quota_identifier(headers.get("X-Render-Quota-Id") if headers else None),
            retry_after_ms=safe_retry_after(headers.get("X-Render-Retry-After-Ms") if headers else None),
            provider_model=headers.get("X-Render-TTS-Model") if headers else None,
            stage_code=safe_callback_stage_code(headers)) from None
    except (urllib.error.URLError, TimeoutError):
        raise RenderError("Falha de rede ao conectar ao endpoint interno do Estúdio.", operation=operation, error_code="render_network_error") from None

def gh_request(method: str, url: str, body: bytes | None = None, content_type: str = "application/vnd.github+json"):
    if not GH_TOKEN:
        raise RenderError("Credencial de execução ausente.", operation="release", error_code="github_api_failed")
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
        try:
            return json.loads(data.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise RenderError("GitHub retornou resposta inválida na etapa de Release.", operation="release", error_code="github_api_failed") from None
    except urllib.error.HTTPError as exc:
        raise RenderError("GitHub API recusou a etapa de Release.", operation="release", error_code="github_api_failed", http_status=exc.code) from None
    except (urllib.error.URLError, TimeoutError):
        raise RenderError("Falha de rede ao falar com GitHub Releases.", operation="release", error_code="github_api_failed") from None

def run(command: list[str], label: str):
    try:
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, timeout=900)
    except subprocess.TimeoutExpired as exc:
        raise RenderError("Tempo limite excedido durante uma etapa do FFmpeg.", operation="render", error_code="ffmpeg_failed") from exc
    except subprocess.CalledProcessError as exc:
        raise RenderError("Falha durante uma etapa do FFmpeg.", operation="render", error_code="ffmpeg_failed") from None

def ffprobe(path: Path) -> dict:
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-show_entries", "stream=codec_type,codec_name,width,height,sample_rate,channels", "-of", "json", str(path)], check=True, capture_output=True, text=True, timeout=20)
        return json.loads(result.stdout)
    except Exception:
        raise RenderError("Não foi possível inspecionar o MP4 final.", operation="qa", error_code="qa_failed") from None

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
            raise RenderError("Formato de captura inválido.", operation="input", error_code="input_operation_failed")
        image.load()
        return ImageOps.exif_transpose(image).convert("RGB")
    except RenderError:
        raise
    except Exception:
        raise RenderError("Não foi possível ler uma captura enviada.", operation="input", error_code="input_operation_failed") from None

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
    text_left = pad
    text_max_width = width - 2 * pad
    if capture is not None:
        frame = (pad, main_top, width - pad, main_top + int((main_bottom-main_top) * 0.67))
        draw.rounded_rectangle(frame, radius=int(18 * scale), fill=(22, 31, 49), outline=(69, 83, 107), width=max(2, int(2*scale)))
        max_size = (frame[2]-frame[0]-int(28*scale), frame[3]-frame[1]-int(28*scale))
        thumb = ImageOps.contain(capture, max_size, method=Image.Resampling.LANCZOS)
        image.paste(thumb, (frame[0] + (frame[2]-frame[0]-thumb.width)//2, frame[1] + (frame[3]-frame[1]-thumb.height)//2))
        draw = ImageDraw.Draw(image)
        text_y = frame[3] + int(24 * scale)
    else:
        focus_frame = (pad, main_top, width - pad, main_bottom)
        draw.rounded_rectangle(focus_frame, radius=int(24 * scale), fill=(22, 31, 49), outline=(69, 83, 107), width=max(2, int(2*scale)))
        draw.rounded_rectangle((focus_frame[0], focus_frame[1], focus_frame[0] + int(9*scale), focus_frame[3]), radius=int(5*scale), fill=(198, 255, 77))
        section_index = cue.get("sectionIndex")
        section_number = section_index + 1 if isinstance(section_index, int) and not isinstance(section_index, bool) else 1
        label_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int(16 * scale))
        inner_left = focus_frame[0] + int(34 * scale)
        text_left = inner_left
        draw.text((inner_left, focus_frame[1] + int(32 * scale)), f"TRECHO ATUAL  ·  SEÇÃO {section_number:02d}  ·  CUE {index+1:02d}", font=label_font, fill=(198, 255, 77))
        text_y = focus_frame[1] + int(88 * scale)
        text_max_width = focus_frame[2] - inner_left - int(34 * scale)
    body_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", int((46 if width > height else 56) * scale))
    cue_text = str(cue.get("text", "")).strip()
    lines = wrap_pixels(draw, cue_text, body_font, text_max_width, max_lines=5)
    line_h = int(body_font.size * 1.22)
    for line in lines:
        draw.text((text_left, text_y), line, font=body_font, fill=(245, 247, 252))
        text_y += line_h
    code_blocks = manifest.get("codeBlocks") or []
    if code_blocks:
        code = str(code_blocks[index % len(code_blocks)]).splitlines()[:6]
        code_y = min(text_y + int(18*scale), height - int(105*scale))
        mono = font("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", int(18 * scale))
        box = (text_left, code_y, width-pad, min(height-int(72*scale), code_y+int((len(code)+1)*29*scale)))
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

def parse_srt_time(value: str) -> float:
    match = re.fullmatch(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})", value.strip())
    if not match:
        raise RenderError("Timestamp SRT inválido para gerar legendas.", operation="render", error_code="manifest_invalid")
    hours, minutes, seconds = (int(match.group(index)) for index in range(1, 4))
    millis = int(match.group(4).ljust(3, "0"))
    return hours * 3600 + minutes * 60 + seconds + millis / 1000

def parse_srt(path: Path) -> list[tuple[float, float, str]]:
    content = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
    entries = []
    for block in re.split(r"\n\s*\n", content.strip()):
        lines = [line.strip() for line in block.splitlines() if line.strip()]
        time_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if time_index is None:
            continue
        match = re.fullmatch(r"(.+?)\s+-->\s+(.+?)(?:\s+.*)?", lines[time_index])
        if not match:
            raise RenderError("Faixa de tempo SRT inválida para gerar legendas.", operation="render", error_code="manifest_invalid")
        start = parse_srt_time(match.group(1))
        end = parse_srt_time(match.group(2))
        text = " ".join(lines[time_index + 1:]).strip()
        if not text or end <= start:
            raise RenderError("Cue SRT vazio ou com duração inválida.", operation="render", error_code="manifest_invalid")
        entries.append((start, end, text))
    if not entries:
        raise RenderError("SRT sem cues para renderizar.", operation="render", error_code="manifest_invalid")
    return entries

def ass_time(seconds: float) -> str:
    total_cs = max(0, int(round(seconds * 100)))
    hours, rem = divmod(total_cs, 360_000)
    minutes, rem = divmod(rem, 6_000)
    secs, centiseconds = divmod(rem, 100)
    return f"{hours}:{minutes:02}:{secs:02}.{centiseconds:02}"

def caption_lines(text: str, width: int, font_size: int) -> list[str]:
    selected_font = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
    draw = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    max_width = int(width * 0.90)
    lines: list[str] = []
    current: list[str] = []
    for word in text.split():
        candidate = " ".join([*current, word])
        too_many_words = len(current) >= 7
        too_wide = bool(current) and draw.textbbox((0, 0), candidate, font=selected_font)[2] > max_width
        if current and (too_many_words or too_wide):
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines or [""]

def build_ass(entries: list[tuple[float, float, str]], path: Path, dimensions: tuple[int, int]):
    width, height = dimensions
    font_size = max(1, int(width * 0.038))
    margin_x = int(width * 0.05)
    margin_v = int(height * 0.05)
    outline = max(1, int(font_size * 0.05))
    header = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes", "WrapStyle: 2", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,DejaVu Sans,{font_size},&H00FFFFFF,&H000000FF,&H00101624,&H80000000,-1,0,1,{outline},1,2,{margin_x},{margin_x},{margin_v},1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    dialogue_lines = []
    for start, end, text in entries:
        if end <= start:
            raise RenderError("Cue SRT com duração inválida para ASS.", operation="render", error_code="manifest_invalid")
        lines = caption_lines(text, width, font_size)
        groups = [lines[index:index + 2] for index in range(0, len(lines), 2)]
        weights = [max(1, sum(len(line) for line in group)) for group in groups]
        total_weight = sum(weights)
        duration = end - start
        elapsed_weight = 0
        for index, (group, weight) in enumerate(zip(groups, weights)):
            segment_start = start + duration * elapsed_weight / total_weight
            elapsed_weight += weight
            segment_end = end if index == len(groups) - 1 else start + duration * elapsed_weight / total_weight
            display_text = r"\N".join(line.replace("\\", "＼").replace("{", "｛").replace("}", "｝") for line in group)
            dialogue_lines.append(f"Dialogue: 0,{ass_time(segment_start)},{ass_time(segment_end)},Default,,0,0,0,,{display_text}")
    path.write_text("\n".join([*header, *dialogue_lines, ""]), encoding="utf-8")

def callback(manifest: dict, status: str, progress: int, *, message: str | None = None, result: dict | None = None, diagnostic: RenderError | None = None):
    payload = {"eventId": str(uuid.uuid4()), "jobId": manifest["jobId"], "workflowRunId": RUN_ID, "status": status, "progress": progress}
    if message and status != "failed":
        payload["message"] = message[:350]
    if diagnostic:
        if status != "failed":
            raise RenderError("Diagnóstico só pode ser enviado em callback de falha.", operation="callback", error_code="callback_operation_failed")
        payload.update({"errorOperation": diagnostic.operation, "errorCode": diagnostic.error_code})
        if diagnostic.http_status is not None:
            payload["httpStatus"] = diagnostic.http_status
        if diagnostic.upstream_status is not None:
            payload["upstreamStatus"] = diagnostic.upstream_status
        if diagnostic.quota_scope is not None:
            payload["quotaScope"] = diagnostic.quota_scope
        if diagnostic.quota_value is not None:
            payload["quotaValue"] = diagnostic.quota_value
        if diagnostic.quota_metric is not None:
            payload["quotaMetric"] = diagnostic.quota_metric
        if diagnostic.quota_id is not None:
            payload["quotaId"] = diagnostic.quota_id
        if diagnostic.retry_after_ms is not None:
            payload["retryAfterMs"] = diagnostic.retry_after_ms
        if diagnostic.provider_model is not None:
            payload["providerModel"] = diagnostic.provider_model
    if result:
        payload.update(result)
    body = compact_json(payload)
    response, _ = post_studio("/api/render?op=callback", body)
    if not response.get("ok"):
        raise RenderError("O Estúdio não confirmou o callback do job.", operation="callback", error_code="callback_not_confirmed")
    return response

def validate_visual_directions(manifest: dict):
    directions = manifest.get("visualDirections", [])
    sections = manifest.get("sections", [])
    if not isinstance(directions, list) or len(directions) > 80 or not isinstance(sections, list):
        raise RenderError("Direções visuais inválidas no manifesto.", operation="manifest", error_code="manifest_invalid")
    for direction in directions:
        if not isinstance(direction, dict):
            raise RenderError("Direção visual inválida no manifesto.", operation="manifest", error_code="manifest_invalid")
        section_index = direction.get("sectionIndex")
        section = direction.get("section")
        text = direction.get("text")
        if (not isinstance(section_index, int) or isinstance(section_index, bool)
                or section_index < 0 or section_index >= len(sections)
                or not isinstance(section, str) or section != sections[section_index]
                or not isinstance(text, str) or not text.strip() or len(text) > 2_000):
            raise RenderError("Mapeamento da direção visual para seção inválido.", operation="manifest", error_code="manifest_invalid")
    return directions

def fetch_manifest() -> dict:
    body = compact_json({"jobId": JOB_ID})
    response, _ = post_studio("/api/render?op=manifest", body, verify_signature=True)
    manifest = response
    if manifest.get("jobId") != JOB_ID or not manifest.get("cues") or len(manifest["cues"]) > 80:
        raise RenderError("O manifesto não corresponde ao job ou não contém cues válidos.", operation="manifest", error_code="manifest_invalid")
    if "visualDirections" in manifest:
        validate_visual_directions(manifest)
    if manifest.get("voiceMode") == "TTS":
        validate_tts_chunks(manifest)
    return manifest

def validate_tts_chunks(manifest: dict) -> dict[int, dict]:
    chunks = manifest.get("ttsChunks")
    cues = manifest.get("cues")
    if not isinstance(chunks, list) or not chunks or len(chunks) > 80 or not isinstance(cues, list):
        raise RenderError("Manifesto TTS não contém blocos válidos.", operation="manifest", error_code="manifest_invalid")
    mapping: dict[int, dict] = {}
    seen: set[int] = set()
    expected_cue_index = 0
    for expected_index, chunk in enumerate(chunks):
        if not isinstance(chunk, dict) or chunk.get("index") != expected_index or not isinstance(chunk.get("text"), str) or not 1 <= len(chunk["text"]) <= 2_000:
            raise RenderError("Bloco TTS inválido no manifesto.", operation="manifest", error_code="manifest_invalid")
        indices = chunk.get("cueIndices")
        if not isinstance(indices, list) or not indices:
            raise RenderError("Mapeamento de legendas TTS inválido.", operation="manifest", error_code="manifest_invalid")
        for cue_index in indices:
            if not isinstance(cue_index, int) or cue_index != expected_cue_index or cue_index < 0 or cue_index >= len(cues) or cue_index in seen:
                raise RenderError("Mapeamento de legendas TTS inválido.", operation="manifest", error_code="manifest_invalid")
            seen.add(cue_index)
            mapping[cue_index] = chunk
            expected_cue_index += 1
    if seen != set(range(len(cues))):
        raise RenderError("Blocos TTS não cobrem todas as legendas.", operation="manifest", error_code="manifest_invalid")
    return mapping

def fetch_voice(job_id: str, chunk_index: int, output: Path) -> float:
    body = compact_json({"jobId": job_id, "chunkIndex": chunk_index})
    audio, headers = post_studio("/api/render?op=voice", body, response_type="binary")
    if len(audio) < 64 or audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise RenderError("O adaptador TTS não retornou WAV válido.", operation="voice", error_code="invalid_tts_wav")
    output.write_bytes(audio)
    try:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(output)], check=True, capture_output=True, text=True, timeout=20)
        duration = float(result.stdout.strip())
    except Exception:
        raise RenderError("Não foi possível validar o WAV do provedor.", operation="voice", error_code="invalid_tts_wav") from None
    if not 0.2 <= duration <= 120:
        raise RenderError("Duração de um trecho TTS fora do limite seguro.", operation="voice", error_code="invalid_tts_duration")
    return duration

def fetch_inputs(manifest: dict, directory: Path) -> list[dict]:
    captures = []
    section_count = len(manifest.get("sections", []))
    for item in manifest.get("inputs", []):
        if len(captures) >= 5:
            break
        if not isinstance(item, dict):
            raise RenderError("Captura inválida no manifesto.", operation="input", error_code="manifest_invalid")
        section_index = item.get("sectionIndex")
        if section_index is not None and (not isinstance(section_index, int) or isinstance(section_index, bool) or section_index < 0 or section_index >= section_count):
            raise RenderError("Índice de seção inválido na captura do manifesto.", operation="input", error_code="manifest_invalid")
        body = compact_json({"jobId": manifest["jobId"], "inputAssetId": item["id"]})
        data, headers = post_studio("/api/render?op=input", body, response_type="binary")
        digest = hashlib.sha256(data).hexdigest()
        if not hmac.compare_digest(digest, item["sha256"]) or len(data) != int(item["sizeBytes"]):
            raise RenderError("A captura transferida não corresponde ao manifesto.", operation="input", error_code="input_operation_failed")
        path = directory / f"capture-{len(captures):02d}.img"
        path.write_bytes(data)
        image = load_capture(data, item["contentType"])
        captures.append({"image": image, "sectionIndex": section_index})
    return captures

def cue_section_index(manifest: dict, cue: dict) -> int | None:
    sections = manifest.get("sections", [])
    section = cue.get("section")
    for direction in manifest.get("visualDirections", []):
        if not isinstance(direction, dict) or direction.get("section") != section:
            continue
        visual_index = direction.get("sectionIndex")
        if isinstance(visual_index, int) and not isinstance(visual_index, bool) and 0 <= visual_index < len(sections):
            return visual_index
    section_index = cue.get("sectionIndex")
    if isinstance(section_index, int) and not isinstance(section_index, bool) and 0 <= section_index < len(sections):
        return section_index
    try:
        return sections.index(section)
    except (ValueError, AttributeError):
        return None

def compose_section_captures(images: list[Image.Image]) -> Image.Image | None:
    if not images:
        return None
    if len(images) == 1:
        return images[0]
    columns = 2
    rows = (len(images) + columns - 1) // columns
    canvas_size = (1200, 720)
    margin = 16
    tile_width = (canvas_size[0] - margin * (columns + 1)) // columns
    tile_height = (canvas_size[1] - margin * (rows + 1)) // rows
    canvas = Image.new("RGB", canvas_size, (22, 31, 49))
    draw = ImageDraw.Draw(canvas)
    for index, source in enumerate(images):
        column, row = index % columns, index // columns
        left, top = margin + column * (tile_width + margin), margin + row * (tile_height + margin)
        draw.rounded_rectangle((left, top, left + tile_width, top + tile_height), radius=12, fill=(12, 18, 29), outline=(69, 83, 107), width=2)
        thumb = ImageOps.contain(source, (tile_width - 20, tile_height - 20), method=Image.Resampling.LANCZOS)
        canvas.paste(thumb, (left + (tile_width - thumb.width) // 2, top + (tile_height - thumb.height) // 2))
        draw = ImageDraw.Draw(canvas)
    return canvas

def select_capture_for_cue(manifest: dict, cue: dict, cue_index: int, captures: list[dict]) -> Image.Image | None:
    section_index = cue_section_index(manifest, cue)
    if section_index is not None:
        prior_cues = manifest.get("cues", [])[:cue_index]
        first_in_section = not any(cue_section_index(manifest, prior) == section_index for prior in prior_cues)
        if first_in_section:
            mapped = [capture["image"] for capture in captures if capture.get("sectionIndex") == section_index]
            if mapped:
                return compose_section_captures(mapped)
    if cue_index == 0:
        unassigned = next((capture for capture in captures if capture.get("sectionIndex") is None), None)
        if unassigned:
            return unassigned["image"]
    return None

def make_music_track(duration: float, output: Path):
    duration = max(duration, 2.0)
    expr = "0.055*sin(2*PI*174.61*t)+0.045*sin(2*PI*220.00*t)+0.035*sin(2*PI*261.63*t)+0.025*sin(2*PI*329.63*t)"
    audio_src = f"aevalsrc={expr}:s=48000:d={duration:.3f}"
    fade_out = max(0.0, duration-2.0)
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", audio_src, "-af", f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_out:.3f}:d=2,volume=0.7", "-c:a", "pcm_s16le", str(output)], "gerar trilha instrumental sintética")

def detect_silence_intervals(audio_path: Path) -> list[tuple[float, float]]:
    """Detecta pausas sem guardar áudio nem imprimir saída; retorna lista vazia se indisponível."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio_path), "-af", "silencedetect=noise=-35dB:d=0.12", "-f", "null", "-"],
            check=False, capture_output=True, text=True, timeout=25,
        )
    except Exception:
        return []
    if result.returncode != 0:
        return []
    starts: list[float] = []
    intervals: list[tuple[float, float]] = []
    for line in result.stderr.splitlines():
        start_match = re.search(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)", line)
        end_match = re.search(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)", line)
        if start_match:
            starts.append(float(start_match.group(1)))
        if end_match and starts:
            intervals.append((starts.pop(0), float(end_match.group(1))))
    return [(start, end) for start, end in intervals if 0 <= start < end]

def allocate_cue_timings(cue_texts: list[str], duration: float, silences: list[tuple[float, float]] | None = None) -> list[tuple[float, float]]:
    """Aloca tempos proporcionalmente ao texto e ajusta a fronteira a pausas próximas quando existem."""
    if not cue_texts or duration <= 0:
        return []
    weights = [max(1, len(text.strip())) for text in cue_texts]
    total_weight = sum(weights)
    timings: list[tuple[float, float]] = []
    previous_end = 0.0
    elapsed_weight = 0
    for index, weight in enumerate(weights):
        start = previous_end
        elapsed_weight += weight
        if index == len(weights) - 1:
            end = duration
            next_start = end
        else:
            target = duration * elapsed_weight / total_weight
            candidates = [
                (silence_start, silence_end) for silence_start, silence_end in (silences or [])
                if previous_end + 0.05 < silence_start < silence_end < duration - 0.05
                and abs((silence_start + silence_end) / 2 - target) <= min(0.75, duration * 0.12)
            ]
            if candidates:
                silence_start, silence_end = min(candidates, key=lambda pair: abs((pair[0] + pair[1]) / 2 - target))
                end, next_start = silence_start, silence_end
            else:
                end = max(previous_end, target)
                next_start = end
        timings.append((start, max(start, end)))
        previous_end = next_start
    return timings

def pause_before_tts_chunk(chunk_index: int):
    if chunk_index > 0:
        time.sleep(TTS_CHUNK_PAUSE_SECONDS)

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
    cue_to_chunk = validate_tts_chunks(manifest) if is_tts else {}
    chunk_audio: dict[int, tuple[Path, float, list[tuple[float, float]]]] = {}
    chunks = manifest.get("ttsChunks", []) if is_tts else []
    if is_tts:
        for chunk in chunks:
            pause_before_tts_chunk(int(chunk["index"]))
            audio_path = directory / f"voice-chunk-{int(chunk['index']):03d}.wav"
            speech_duration = fetch_voice(manifest["jobId"], int(chunk["index"]), audio_path)
            cue_texts = [str(cues[item].get("text", "")) for item in chunk["cueIndices"]]
            timings = allocate_cue_timings(cue_texts, speech_duration, detect_silence_intervals(audio_path))
            chunk_audio[int(chunk["index"])] = (audio_path, speech_duration, timings)
            audio_files.append(audio_path)
    completed_chunks: set[int] = set()
    for index, cue in enumerate(cues):
        if is_tts:
            cue_index = int(cue["index"])
            chunk = cue_to_chunk[cue_index]
            chunk_index = int(chunk["index"])
            local_index = chunk["cueIndices"].index(cue_index)
            cue_start, cue_end = chunk_audio[chunk_index][2][local_index]
            is_last_cue = chunk["cueIndices"][-1] == cue_index
            chunk_start = time_cursor - cue_start
            subtitles.append((chunk_start + cue_start, chunk_start + cue_end, str(cue["text"])))
            if is_last_cue:
                segment_duration = chunk_audio[chunk_index][1] - cue_start + 0.25
            else:
                next_cue_start = chunk_audio[chunk_index][2][local_index + 1][0]
                segment_duration = next_cue_start - cue_start
        else:
            segment_duration = min(14.0, max(3.5, len(str(cue["text"])) / 14.0 + 1.5))
            subtitles.append((time_cursor, time_cursor + segment_duration, str(cue["text"])))
        durations.append(segment_duration)
        slide = directory / f"slide-{index:03d}.png"
        capture = select_capture_for_cue(manifest, cue, index, captures)
        make_slide(slide, manifest, cue, index, dimensions, capture)
        slides.append(slide)
        time_cursor += segment_duration
        if is_tts and is_last_cue and chunk_index not in completed_chunks:
            completed_chunks.add(chunk_index)
            callback(manifest, "rendering", min(55, 8 + int(45 * len(completed_chunks) / max(1, len(chunks)))))
    if not is_tts:
        callback(manifest, "rendering", 50)

    srt_path = directory / "captions.srt"
    build_srt(subtitles, srt_path)
    ass_path = directory / "captions.ass"
    build_ass(parse_srt(srt_path), ass_path, dimensions)
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
    ass_filter_path = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    subtitle_filter = f"subtitles=filename='{ass_filter_path}':fontsdir='/usr/share/fonts/truetype/dejavu'"
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
        {"label": "captions", "passed": bool(captions and "-->" in captions and len(captions.split("-->")) >= 2), "verified": True, "note": f"SRT com {len(manifest['cues'])} cues; sincronismo aproximado por texto/silêncio; legendas queimadas no MP4" if manifest.get("voiceMode") == "TTS" else f"SRT com {len(manifest['cues'])} cues; legendas queimadas no MP4"},
        {"label": "duration", "passed": 0 < duration <= 7200 and short_limit, "verified": True, "note": f"Duração medida por ffprobe: {duration:.2f}s"},
        {"label": "file_size", "passed": 10_000 < size <= MAX_OUTPUT_BYTES, "verified": True, "note": f"Arquivo verificado: {size} bytes"},
    ]
    return checks, duration, size

def create_release_and_upload(video: Path, captions: Path, manifest: dict) -> tuple[int, int]:
    tag = f"studio-render-{manifest['jobId']}"
    release = gh_request("POST", GH_API + "/releases", compact_json({"tag_name": tag, "name": f"Render privado · {manifest['title'][:100]}", "body": "Asset temporário do Estúdio. Release em rascunho; não publicado.", "draft": True, "prerelease": True, "generate_release_notes": False}))
    if not release or not release.get("id"):
        raise RenderError("GitHub não confirmou o draft Release.", operation="release", error_code="github_api_failed")
    upload_base = str(release.get("upload_url", "")).split("{", 1)[0]
    if not upload_base:
        raise RenderError("GitHub Release não forneceu URL de upload.", operation="release", error_code="github_api_failed")
    video_asset = upload_release_asset(upload_base + "?name=" + urllib.parse.quote(video.name), video, "video/mp4")
    # O SRT acompanha o MP4 para edição posterior; o app usa o asset de vídeo principal.
    upload_release_asset(upload_base + "?name=" + urllib.parse.quote(f"{manifest['jobId']}.srt"), captions, "text/plain")
    if not video_asset or not video_asset.get("id"):
        raise RenderError("O draft Release não confirmou o asset MP4.", operation="release", error_code="github_api_failed")
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
        if response.status < 200 or response.status >= 300:
            status = response.status
            response.close()
            raise RenderError("GitHub recusou o upload de asset.", operation="release", error_code="github_upload_failed", http_status=status)
        payload = response.read(2 * 1024 * 1024)
        return json.loads(payload.decode("utf-8"))
    except (OSError, http.client.HTTPException, TimeoutError, UnicodeDecodeError, json.JSONDecodeError):
        raise RenderError("Não foi possível concluir o upload do asset.", operation="release", error_code="github_upload_failed") from None
    finally:
        connection.close()

def main():
    if not SECRET or len(SECRET) < 32 or not re.fullmatch(r"[0-9a-f-]{36}", JOB_ID, re.I) or RUN_ID < 1:
        raise RenderError("Configuração de execução incompleta; nada foi enviado.", operation="worker", error_code="worker_unexpected")
    WORK.mkdir(parents=True, exist_ok=True)
    manifest = fetch_manifest()
    callback(manifest, "rendering", 3)
    video, captions, duration = create_video(manifest, WORK)
    probed = ffprobe(video)
    checks, duration, size = qa_result(video, captions, probed, manifest)
    if size > MAX_OUTPUT_BYTES:
        raise RenderError("O MP4 excedeu o limite seguro.", operation="qa", error_code="qa_failed")
    callback(manifest, "rendering", 88)
    release_id, asset_id = create_release_and_upload(video, captions, manifest)
    result = {"releaseId": release_id, "assetId": asset_id, "fileName": video.name, "fileSizeBytes": size, "durationSeconds": round(duration, 3), "qa": checks}
    response = callback(manifest, "qa", 95, result=result)
    if response.get("status") != "succeeded":
        raise RenderError("O QA do Estúdio não aprovou o MP4.", operation="qa", error_code="qa_failed")
    print(f"Render concluído. job={JOB_ID} release={release_id} asset={asset_id} duração={duration:.2f}s tamanho={size} bytes")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        diagnostic = exc if isinstance(exc, RenderError) else RenderError("Falha inesperada no worker.", operation="worker", error_code="worker_unexpected")
        try:
            if JOB_ID and SECRET and RUN_ID:
                fallback = {"jobId": JOB_ID, "cues": [], "title": "Render"}
                callback(fallback, "failed", 90, diagnostic=diagnostic)
        except Exception:
            print(json.dumps({"event": "render_failure_callback_failed", "operation": "callback", "errorCode": "callback_operation_failed"}, separators=(",", ":")), file=sys.stderr)
        record = {"event": "render_failed", "operation": diagnostic.operation, "errorCode": diagnostic.error_code}
        if diagnostic.http_status is not None:
            record["httpStatus"] = diagnostic.http_status
        if diagnostic.upstream_status is not None:
            record["upstreamStatus"] = diagnostic.upstream_status
        if diagnostic.stage_code is not None:
            record["stageCode"] = diagnostic.stage_code
        print(json.dumps(record, separators=(",", ":")), file=sys.stderr)
        sys.exit(1)
