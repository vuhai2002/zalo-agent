import fs from "node:fs";
import { LoginQRCallbackEventType, Zalo, type API, type Credentials } from "zca-js";
import type { ImageMetadataGetter } from "zca-js";
import { imageSize } from "image-size";
import { createLogger } from "../shared/logger.js";
import { loadCredentials, saveCredentials } from "./zalo-credential-store.js";

const log = createLogger("zalo-client");

// zca-js v2 bỏ sharp - phải tự cung cấp hàm đọc metadata ảnh khi gửi ảnh
const imageMetadataGetter: ImageMetadataGetter = async (filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const { width, height } = imageSize(buffer);
    if (!width || !height) return null;
    return { width, height, size: buffer.byteLength };
  } catch {
    return null;
  }
};

function createZaloInstance(): Zalo {
  return new Zalo({
    checkUpdate: false,
    logging: false,
    selfListen: false,
    imageMetadataGetter,
  });
}

export async function loginWithStoredCredentials(accountId: string): Promise<API> {
  const stored = loadCredentials(accountId);
  if (!stored) {
    throw new Error(
      `Chưa có credentials cho account "${accountId}" - chạy: pnpm login ${accountId}`,
    );
  }

  const api = await createZaloInstance().login(stored as Credentials);
  log.info({ accountId }, "Đăng nhập bằng cookie đã lưu thành công");
  return api;
}

export async function loginWithQR(
  accountId: string,
  qrPath: string,
  onQrSaved?: (qrPath: string) => void,
): Promise<API> {
  // Lưu ý: khi truyền callback, zca-js KHÔNG tự ghi file QR nữa - phải tự gọi
  // actions.saveToFile(). Bỏ qua bước này thì không có ảnh QR nào được tạo.
  const api = await createZaloInstance().loginQR({ qrPath }, async (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        await event.actions.saveToFile(qrPath);
        log.info({ accountId, qrPath }, "Đã tạo mã QR - quét bằng app Zalo");
        onQrSaved?.(qrPath);
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        log.info({ accountId }, "Đã quét QR - xác nhận trên điện thoại để hoàn tất");
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        log.warn({ accountId }, "Mã QR hết hạn - đang tạo mã mới");
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        log.warn({ accountId }, "Đăng nhập bị từ chối trên điện thoại");
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        log.info({ accountId }, "Nhận được thông tin đăng nhập");
        break;
    }
  });

  persistCredentialsFromApi(accountId, api);
  return api;
}

/** Lưu cookie/imei/userAgent (mã hóa) để các lần boot sau không cần quét QR */
function persistCredentialsFromApi(accountId: string, api: API): void {
  const ctx = api.getContext();
  saveCredentials(accountId, {
    cookie: ctx.cookie.toJSON()?.cookies ?? [],
    imei: ctx.imei,
    userAgent: ctx.userAgent,
  });
  log.info({ accountId }, "Đã lưu credentials (mã hóa) cho các lần đăng nhập sau");
}

export type QrLoginEvent = {
  type: "qr" | "scanned" | "expired" | "declined" | "info";
  /** Base64 PNG (không có prefix data:) - chỉ có ở type "qr" */
  qrBase64?: string;
};

/**
 * Login QR cho web dashboard: KHÔNG ghi file, lấy thẳng base64 từ
 * event.data.image (đã xác nhận trong zca-js/src/apis/loginQR.ts:433 -
 * lib strip sẵn prefix data:image/png;base64). QR hết hạn zca-js tự tạo
 * mã mới và bắn lại QRCodeGenerated.
 */
export async function loginWithQRForWeb(
  accountId: string,
  onEvent: (event: QrLoginEvent) => void,
): Promise<API> {
  const api = await createZaloInstance().loginQR({}, async (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        onEvent({ type: "qr", qrBase64: (event.data as { image?: string } | null)?.image });
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        onEvent({ type: "scanned" });
        break;
      case LoginQRCallbackEventType.QRCodeExpired:
        onEvent({ type: "expired" });
        break;
      case LoginQRCallbackEventType.QRCodeDeclined:
        onEvent({ type: "declined" });
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        onEvent({ type: "info" });
        break;
    }
  });

  persistCredentialsFromApi(accountId, api);
  return api;
}
