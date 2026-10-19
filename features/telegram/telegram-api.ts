// Helper Telegram Bot API untuk unduh file kiriman pengguna dan mengirim dokumen (Excel/PNG) balik.
const TELEGRAM_FILE_LIMIT_BYTES = 20 * 1024 * 1024; // batas getFile pada Bot API

export async function downloadTelegramFile(botToken: string, fileId: string): Promise<Buffer> {
  const infoResponse = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const info = (await infoResponse.json().catch(() => null)) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
  } | null;
  const filePath = info?.result?.file_path;
  if (!info?.ok || !filePath) throw new Error("Telegram tidak mengizinkan file ini diunduh (maks. 20 MB).");
  if ((info.result?.file_size ?? 0) > TELEGRAM_FILE_LIMIT_BYTES) throw new Error("Ukuran file melebihi 20 MB.");

  const fileResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!fileResponse.ok) throw new Error("Gagal mengunduh file dari Telegram.");
  return Buffer.from(await fileResponse.arrayBuffer());
}

export async function sendTelegramDocument(
  botToken: string,
  chatId: number,
  filename: string,
  bytes: Uint8Array,
  caption?: string,
  mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append(
    "document",
    new Blob([new Uint8Array(bytes)], { type: mimeType }),
    filename,
  );
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { body: form, method: "POST" });
  return response.ok ? { ok: true as const } : { error: await response.text(), ok: false as const };
}
