import type { API } from "zca-js";
import { getAccount, type AccountConfig } from "../../config/account-store.js";
import { getTuning } from "../../config/runtime-tuning-settings.js";
import type { HangChoLayBu } from "../../conversation/offline-replay-cursor-store.js";
import { persistBatchImages } from "../../conversation/media-store.js";
import { enqueueMessage, TRAN_TIN_DON } from "../../middleware/message-batcher.js";
import { createLogger } from "../../shared/logger.js";
import { kenhCaNhan } from "../kenh-ca-nhan.js";
import { processBatch } from "../message-turn-processor.js";
import { ganAnhVaoHistory } from "../record-incoming-message.js";
import type { ParsedMessage } from "../zalo-message-parser.js";
import { docTrangLayBu, LENH_LAY_BU } from "./doc-trang-lay-bu.js";
import { giaiMaKhungWs } from "./giai-ma-khung-ws.js";
import { HangChoTraLoiTre } from "./hang-cho-tra-loi-tre.js";
import { dangKyLayBu, goDangKyLayBu, layBuCuaAccount, type LayBuCuaAccount } from "./lay-bu-registry.js";
import { ganNgheKhungWsTho } from "./raw-ws-frame-listener.js";
import { tiepNhanTinLayBu, type KetQuaTiepNhan } from "./tiep-nhan-tin-lay-bu.js";
import { taoBoXinBu } from "./xin-bu-tin-lo.js";

export type { LayBuCuaAccount } from "./lay-bu-registry.js";

/**
 * Lấy bù tin lỡ cho MỘT account cá nhân: mỗi lần listener kết nối xin Zalo hàng
 * chờ 510/511 (`xin-bu-tin-lo.ts`), đọc phản hồi từ khung WS thô, tiếp nhận từng
 * tin qua bộ lọc chung (`tiep-nhan-tin-lay-bu.ts`), xong lượt thì nhả hàng chờ trả
 * lời trễ vào CHÍNH bộ gộp tin, như router làm với tin trực tiếp.
 * Tham số đọc LÚC DÙNG qua `getTuning` để đổi trên dashboard ăn ngay.
 */
export function batDauLayBuChoAccount(
  config: AccountConfig,
  api: API,
  selfId: string,
  tiem: { enqueue?: (threadKey: string, msg: ParsedMessage) => boolean } = {},
): LayBuCuaAccount | null {
  if (config.loai === "bot") return null;
  const log = createLogger(`lay-bu:${config.id}`);
  const cauHinh = (): AccountConfig => getAccount(config.id) ?? config;

  const hangCho = new HangChoTraLoiTre({
    accountId: config.id,
    enqueue:
      tiem.enqueue ??
      ((threadKey, msg) => enqueueMessage(threadKey, msg, (batch) => processBatch(cauHinh(), kenhCaNhan(api), batch))),
    gianCachMs: () => [getTuning("LAY_BU_GIAN_CACH_MIN_GIAY") * 1000, getTuning("LAY_BU_GIAN_CACH_MAX_GIAY") * 1000],
    luuAnhTinBoQua: (msgs) => {
      if (!msgs.some((m) => m.images.length > 0)) return;
      void persistBatchImages(config.id, msgs)
        .then(() => ganAnhVaoHistory(msgs))
        .catch((err) => log.debug({ err }, "Không gắn được ảnh tin lấy bù bị bỏ lượt"));
    },
    tranTinMoiNguoi: TRAN_TIN_DON,
  });

  let dem: Partial<Record<KetQuaTiepNhan, number>> = {};
  const bo = taoBoXinBu({
    accountId: config.id,
    guiLenh: (cmd, data) => api.listener.sendWs({ version: 1, cmd, subCmd: 1, data }),
    onTin: (hangChoZalo, tinTho) => {
      const ctx = { config: cauHinh(), api, selfId, hangCho, now: new Date(), tranTuoiGio: getTuning("LAY_BU_TRAN_TUOI_GIO") };
      const kq = tiepNhanTinLayBu(ctx, hangChoZalo, tinTho);
      dem[kq] = (dem[kq] ?? 0) + 1;
    },
    onHangChoXong: (kq) => log.info(kq, "Xong một hàng chờ lấy bù"),
    onLuotXong: () => {
      log.info({ ketQua: dem, soThreadChoTraLoi: hangCho.soThreadDangCho() }, "Xong lượt lấy bù tin lỡ");
      dem = {};
      hangCho.nha();
    },
    khoangToiThieuMs: () => getTuning("LAY_BU_KHOANG_TOI_THIEU_PHUT") * 60_000,
  });

  const goNghe = (Object.keys(LENH_LAY_BU) as HangChoLayBu[]).map((h) =>
    ganNgheKhungWsTho(
      api,
      LENH_LAY_BU[h],
      (frame, cipherKey) => {
        const duLieu = giaiMaKhungWs(frame, cipherKey);
        const trang = duLieu ? docTrangLayBu(h, duLieu) : null;
        if (trang) bo.khiTrang(h, trang);
        else bo.khiTrangHong(h, duLieu ? "Trang lấy bù sai hình" : "Không giải mã được trang lấy bù");
      },
      (err) => log.warn({ err, hangCho: h }, "Đọc khung lấy bù hỏng"),
    ),
  );

  const layBu: LayBuCuaAccount = {
    khiKetNoi: () => {
      if (getTuning("LAY_BU_ENABLED")) bo.khiKetNoi();
    },
    khiDongKetNoi: () => bo.khiDongKetNoi(),
    khiTinTrucTiep: (msg) => bo.khiTinTrucTiep(msg.isGroup ? "tin_nhom" : "tin_1_1", msg.msgId),
    nhaNgay: (threadKey) => {
      hangCho.nhaNgay(threadKey);
    },
    dung: () => {
      bo.dung();
      hangCho.dungVaBaoBoDo();
      for (const go of goNghe) go();
      goDangKyLayBu(config.id, layBu);
    },
  };
  layBuCuaAccount(config.id)?.dung();
  dangKyLayBu(config.id, layBu);
  return layBu;
}

export function dungLayBuChoAccount(accountId: string): void {
  layBuCuaAccount(accountId)?.dung();
}
