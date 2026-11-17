import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { cleanupTestEnv, setupTestEnv } from "../shared/test-env-setup.js";
import type { KetQuaTrichXuatTep } from "./attachment-extract-types.js";
import type { PhuThuocLayTep } from "./lay-noi-dung-tep.js";

let dataDir: string;
let lay: typeof import("./lay-noi-dung-tep.js");
let store: typeof import("./attachment-store.js");
let database: typeof import("../conversation/database.js");
let rate: typeof import("../shared/hourly-rate-limit.js");
let tienTrinh: typeof import("../shared/chay-tien-trinh-con-co-tran.js");

before(async () => {
  dataDir = setupTestEnv();
  lay = await import("./lay-noi-dung-tep.js");
  store = await import("./attachment-store.js");
  database = await import("../conversation/database.js");
  rate = await import("../shared/hourly-rate-limit.js");
  tienTrinh = await import("../shared/chay-tien-trinh-con-co-tran.js");
});
after(() => {
  database.closeDatabase();
  cleanupTestEnv(dataDir);
});
beforeEach(() => database.db.exec("DELETE FROM tep_dinh_kem"));

const T0 = new Date("2026-11-17T09:00:00.000Z");
const gio = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const PDF_CHU: KetQuaTrichXuatTep = { dinhDang: "pdf", soTrang: 1, phan: [{ nhan: "Trang 1", chu: "noi dung", nguon: "chu" }], trangCanOcr: [], canhBao: [] };

function tao(duoi = "pdf") {
  return store.layTep(store.ghiTepDen("acc", "t1", 1, "u1", { href: "https://fg1.dlfl.vn/x", ten: `a.${duoi}`, duoiKhai: duoi, coKhai: 1 }, T0))!;
}

function dep(p: Partial<PhuThuocLayTep> & { soTai?: { n: number }; ocrNhan?: number[][]; tranTepGio?: number } = {}): PhuThuocLayTep {
  const soTai = p.soTai ?? { n: 0 };
  return {
    taiTep: async () => {
      soTai.n++;
      await new Promise((r) => setTimeout(r, 5));
      return { ok: true, buf: Buffer.from("%PDF-1.4 x") };
    },
    trichXuat: async () => PDF_CHU,
    ocr: async (_b, so) => {
      p.ocrNhan?.push(so);
      return { trang: so.map((s) => ({ so: s, chu: `ocr ${s}`, cut: false })), boQua: [] };
    },
    gioiHanTep: rate.createHourlyRateLimit({ limit: () => p.tranTepGio ?? 100, buildReason: () => "hết" }),
    lyDoKhongOcr: () => null,
    giuLuotTai: async () => () => {},
    cauHinh: () => ({ maxMb: 20, officeMaxMb: 10, ocrSanTrang: 5, ocrToiDaMoiTep: 50 }),
    ...p,
  };
}

describe("layNoiDungTep", () => {
  it("hai lời gọi song song chỉ tải MỘT lần; cache còn hạn thì không tải lại", async () => {
    const t = tao();
    const soTai = { n: 0 };
    const d = dep({ soTai });
    const [a, b] = await Promise.all([
      lay.layNoiDungTep(t, { nguoiGuiKey: "k1", now: gio(0), deps: d }),
      lay.layNoiDungTep(t, { nguoiGuiKey: "k1", now: gio(0), deps: d }),
    ]);
    assert.equal(a.ok && b.ok, true);
    assert.equal(soTai.n, 1);
    await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k1", now: gio(1), deps: d });
    assert.equal(soTai.n, 1, "cache còn hạn");
    await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k1", now: gio(30), deps: d });
    assert.equal(soTai.n, 2, "cache hết hạn trượt thì tải lại trong suốt");
  });

  it("link hết hạn -> het-han, lần sau trả ngay không tải", async () => {
    const t = tao();
    const soTai = { n: 0 };
    const d = dep({ soTai, taiTep: async () => (soTai.n++, { ok: false, ma: "het-han" }) });
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k2", now: T0, deps: d }), { ok: false, ma: "het-han" });
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k2", now: T0, deps: d }), { ok: false, ma: "het-han" });
    assert.equal(soTai.n, 1);
  });

  it("tiến trình con bị ngắt -> bi-ngat, KHÔNG ghi lỗi, lần sau thử lại được", async () => {
    const t = tao();
    let lan = 0;
    const d = dep({
      trichXuat: async () => {
        if (lan++ === 0) throw new tienTrinh.LoiTienTrinhConBiNgat("vuot-ram", "vượt");
        return PDF_CHU;
      },
    });
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k3", now: T0, deps: d }), { ok: false, ma: "bi-ngat" });
    assert.equal(store.layTep(t.id)!.maLoi, null);
    assert.equal((await lay.layNoiDungTep(t, { nguoiGuiKey: "k3", now: T0, deps: d })).ok, true);
  });

  it("tệp làm tiến trình con chết HAI lần -> lần sau trả bi-ngat ngay, KHÔNG tải lại", async () => {
    const t = tao();
    const soTai = { n: 0 };
    const d = dep({
      soTai,
      trichXuat: async () => {
        throw new tienTrinh.LoiTienTrinhConBiNgat("het-gio", "hết giờ");
      },
    });
    for (let i = 0; i < 2; i++) assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k9", now: T0, deps: d }), { ok: false, ma: "bi-ngat" });
    assert.equal(soTai.n, 2);
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k9", now: T0, deps: d }), { ok: false, ma: "bi-ngat" });
    assert.equal(soTai.n, 2, "tệp độc không được tải + trích lại mỗi lần hỏi");
    // Sau một giờ được thử lại (máy có thể chỉ bận lúc đó)
    await lay.layNoiDungTep(t, { nguoiGuiKey: "k9", now: gio(2), deps: d });
    assert.equal(soTai.n, 3);
  });

  it("nhiều tệp cùng lúc: mỗi người gửi MỘT lượt tải, cả máy tối đa HAI - byte không dồn hết vào RAM", async () => {
    const gioiHan = (await import("./gioi-han-luot-tai-tep.js")).taoGioiHanLuotTai({ toiDa: 2, toiDaMoiKey: 1 });
    let dangTai = 0;
    let dinhTong = 0;
    const dinhMoiNguoi = new Map<string, number>();
    const dangTaiMoiNguoi = new Map<string, number>();
    const d = (key: string) =>
      dep({
        giuLuotTai: (k) => gioiHan.giu(k),
        taiTep: async () => {
          dangTai++;
          dangTaiMoiNguoi.set(key, (dangTaiMoiNguoi.get(key) ?? 0) + 1);
          dinhTong = Math.max(dinhTong, dangTai);
          dinhMoiNguoi.set(key, Math.max(dinhMoiNguoi.get(key) ?? 0, dangTaiMoiNguoi.get(key)!));
          await new Promise((r) => setTimeout(r, 10));
          return { ok: true, buf: Buffer.from("%PDF-1.4 x") };
        },
        trichXuat: async () => {
          await new Promise((r) => setTimeout(r, 10));
          dangTai--;
          dangTaiMoiNguoi.set(key, dangTaiMoiNguoi.get(key)! - 1);
          return PDF_CHU;
        },
      });
    const viec = [
      ...[1, 2, 3, 4].map(() => lay.layNoiDungTep(tao(), { nguoiGuiKey: "ke", now: T0, deps: d("ke") })),
      ...[1, 2].map(() => lay.layNoiDungTep(tao(), { nguoiGuiKey: "kf", now: T0, deps: d("kf") })),
      ...[1, 2].map(() => lay.layNoiDungTep(tao(), { nguoiGuiKey: "kg", now: T0, deps: d("kg") })),
    ];
    const kq = await Promise.all(viec);
    assert.ok(kq.every((k) => k.ok));
    assert.equal(dinhTong, 2, "cả máy tối đa 2 tệp đang giữ byte");
    assert.equal(Math.max(...dinhMoiNguoi.values()), 1, "một người gửi tối đa 1 tệp đang giữ byte");
    assert.deepEqual(gioiHan.trangThai(), { dangChay: 0, dangCho: 0 }, "phải nhả hết lượt");
  });

  it("OCR: lần đầu chép sẵn 5 trang; xin dải 4-8 thì chỉ chép phần thiếu 6-8", async () => {
    const t = tao();
    const ocrNhan: number[][] = [];
    const d = dep({ ocrNhan, trichXuat: async () => ({ ...PDF_CHU, soTrang: 9, trangCanOcr: [1, 2, 3, 4, 5, 6, 7, 8] }) });
    const kq1 = await lay.layNoiDungTep(t, { nguoiGuiKey: "k4", now: T0, deps: d });
    assert.ok(kq1.ok);
    assert.deepEqual(ocrNhan, [[1, 2, 3, 4, 5]]);
    assert.deepEqual(kq1.ok && kq1.trangChuaOcr, [6, 7, 8]);
    const kq2 = await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k4", now: T0, daiTrang: [4, 8], deps: d });
    assert.deepEqual(ocrNhan[1], [6, 7, 8]);
    assert.ok(kq2.ok && kq2.noiDung.some((p) => p.nguon === "ocr" && /ocr 8/.test(p.chu)));
    assert.deepEqual(kq2.ok && kq2.trangChuaOcr, []);
  });

  it("trần OCR mỗi tệp: trang vượt trần không được chép và được báo ra", async () => {
    const t = tao();
    const ocrNhan: number[][] = [];
    const tatCa = Array.from({ length: 60 }, (_, i) => i + 1);
    const d = dep({ ocrNhan, trichXuat: async () => ({ ...PDF_CHU, soTrang: 60, trangCanOcr: tatCa }) });
    const kq = await lay.layNoiDungTep(t, { nguoiGuiKey: "k5", now: T0, daiTrang: [45, 60], deps: d });
    assert.deepEqual(ocrNhan[ocrNhan.length - 1], [45, 46, 47, 48, 49, 50]);
    assert.deepEqual(kq.ok && kq.trangVuotTran, tatCa.slice(50));
  });

  it("tệp Word quá trần riêng của Office -> qua-lon", async () => {
    const t = tao("docx");
    const zip = Buffer.alloc(15 * 1024 * 1024);
    zip.writeUInt32LE(0x04034b50, 0); // chữ ký zip - loại thật do byte quyết định
    const d = dep({ taiTep: async () => ({ ok: true, buf: zip }) });
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k6", now: T0, deps: d }), { ok: false, ma: "qua-lon" });
  });

  it("cache ấm + OCR không chạy được (sidecar tắt / hết suất) -> KHÔNG tải lại tệp mỗi lần", async () => {
    const t = tao();
    const soTai = { n: 0 };
    const d = dep({ soTai, lyDoKhongOcr: () => "chua-cau-hinh", trichXuat: async () => ({ ...PDF_CHU, trangCanOcr: [1, 2, 3] }) });
    for (let i = 0; i < 4; i++) {
      const kq = await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k8", now: T0, deps: d });
      assert.ok(kq.ok);
      assert.deepEqual(kq.ok && kq.boQuaOcr.map((b) => b.lyDo), ["chua-cau-hinh", "chua-cau-hinh", "chua-cau-hinh"]);
    }
    assert.equal(soTai.n, 1);
  });

  it("tải lại để OCR thêm trang cũng TÍNH suất tệp; hết suất thì vẫn trả phần đã có", async () => {
    const t = tao();
    const soTai = { n: 0 };
    const d = dep({ soTai, tranTepGio: 1, trichXuat: async () => ({ ...PDF_CHU, soTrang: 9, trangCanOcr: [1, 2, 3, 4, 5, 6, 7, 8] }) });
    assert.ok((await lay.layNoiDungTep(t, { nguoiGuiKey: "k9", now: T0, deps: d })).ok);
    const kq = await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k9", now: T0, daiTrang: [6, 8], deps: d });
    assert.equal(soTai.n, 1, "hết suất thì không tải");
    assert.ok(kq.ok);
    assert.deepEqual(kq.ok && kq.boQuaOcr.map((b) => [b.so, b.lyDo]), [[6, "het-tran-gio"], [7, "het-tran-gio"], [8, "het-tran-gio"]]);
  });

  it("link hết hạn lúc tải lại để OCR: ghi het-han nhưng VẪN trả chữ còn trong cache, lần sau không tải lại", async () => {
    const t = tao();
    const soTai = { n: 0 };
    let lan = 0;
    const d = dep({
      soTai,
      taiTep: async () => (soTai.n++, lan++ === 0 ? { ok: true, buf: Buffer.from("%PDF-1.4") } : { ok: false, ma: "het-han" }),
      trichXuat: async () => ({ ...PDF_CHU, soTrang: 9, trangCanOcr: [1, 2, 3, 4, 5, 6, 7, 8] }),
    });
    await lay.layNoiDungTep(t, { nguoiGuiKey: "k10", now: T0, deps: d });
    const kq2 = await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k10", now: T0, daiTrang: [6, 8], deps: d });
    assert.ok(kq2.ok && kq2.noiDung.length > 0);
    assert.equal(store.layTep(t.id)!.maLoi, "het-han");
    const kq3 = await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k10", now: T0, daiTrang: [6, 8], deps: d });
    assert.ok(kq3.ok, "cache còn hạn thì vẫn đọc được");
    assert.equal(soTai.n, 2, "không thử tải lại link đã biết là chết");
  });

  it("quá trần dung lượng KHÔNG ghi vĩnh viễn - người vận hành nâng trần thì đọc lại được", async () => {
    const t = tao("docx");
    const zip = Buffer.alloc(15 * 1024 * 1024);
    zip.writeUInt32LE(0x04034b50, 0);
    let officeMaxMb = 10;
    const d = dep({ taiTep: async () => ({ ok: true, buf: zip }), trichXuat: async () => ({ ...PDF_CHU, dinhDang: "docx" }) });
    d.cauHinh = () => ({ maxMb: 20, officeMaxMb, ocrSanTrang: 5, ocrToiDaMoiTep: 50 });
    assert.deepEqual(await lay.layNoiDungTep(t, { nguoiGuiKey: "k11", now: T0, deps: d }), { ok: false, ma: "qua-lon" });
    officeMaxMb = 20;
    assert.equal((await lay.layNoiDungTep(store.layTep(t.id)!, { nguoiGuiKey: "k11", now: T0, deps: d })).ok, true);
  });

  it("host lạ: hoàn suất và ghi lại (link không bao giờ đổi)", async () => {
    const soTai = { n: 0 };
    const d = dep({ soTai, tranTepGio: 1, taiTep: async () => (soTai.n++, { ok: false, ma: "host-la" }) });
    const a = tao();
    assert.deepEqual(await lay.layNoiDungTep(a, { nguoiGuiKey: "k12", now: T0, deps: d }), { ok: false, ma: "host-la" });
    assert.deepEqual(await lay.layNoiDungTep(store.layTep(a.id)!, { nguoiGuiKey: "k12", now: T0, deps: d }), { ok: false, ma: "host-la" });
    assert.equal(soTai.n, 1);
    d.taiTep = async () => ({ ok: true, buf: Buffer.from("%PDF-1.4") });
    assert.equal((await lay.layNoiDungTep(tao(), { nguoiGuiKey: "k12", now: T0, deps: d })).ok, true, "suất đã được hoàn");
  });

  it("trần tệp tải mới mỗi giờ: tệp thứ 3 -> het-tran-gio, đọc lại tệp 1 từ cache vẫn được", async () => {
    const d = dep({ tranTepGio: 2 });
    const [t1, t2, t3] = [tao(), tao(), tao()];
    assert.equal((await lay.layNoiDungTep(t1, { nguoiGuiKey: "k7", now: T0, deps: d })).ok, true);
    assert.equal((await lay.layNoiDungTep(t2, { nguoiGuiKey: "k7", now: T0, deps: d })).ok, true);
    assert.deepEqual(await lay.layNoiDungTep(t3, { nguoiGuiKey: "k7", now: T0, deps: d }), { ok: false, ma: "het-tran-gio" });
    assert.equal((await lay.layNoiDungTep(store.layTep(t1.id)!, { nguoiGuiKey: "k7", now: T0, deps: d })).ok, true);
  });
});
