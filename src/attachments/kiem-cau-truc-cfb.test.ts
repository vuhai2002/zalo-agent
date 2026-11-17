import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { taoCfb } from "./fixtures/tao-cfb-thu-nghiem.js";
import { kiemCauTrucCfb } from "./kiem-cau-truc-cfb.js";

const hopLe = () =>
  taoCfb([
    { ten: "WordDocument", data: Buffer.alloc(5000) },
    { ten: "1Table", data: Buffer.alloc(4200, 2) },
  ]);

describe("kiemCauTrucCfb - chặn CFB độc trước khi tới word-extractor", () => {
  it("CFB hợp lệ có WordDocument -> ok", () => {
    const kq = kiemCauTrucCfb(hopLe().buf);
    assert.deepEqual(kq, { ok: true, coWordDocument: true, coEncryptedPackage: false });
  });

  it("có EncryptedPackage (Office có mật khẩu) -> ok, cờ mã hóa bật", () => {
    const kq = kiemCauTrucCfb(
      taoCfb([
        { ten: "EncryptionInfo", data: Buffer.alloc(10) },
        { ten: "EncryptedPackage", data: Buffer.alloc(10) },
      ]).buf,
    );
    assert.equal(kq.ok, true);
    assert.equal(kq.ok && kq.coEncryptedPackage, true);
    assert.equal(kq.ok && kq.coWordDocument, false);
  });

  it("shift 27 (sector 128 MB - PoC làm abort cả tiến trình) -> hỏng, chạy nhanh, không cấp phát lớn", () => {
    const { buf } = hopLe();
    buf.writeUInt16LE(27, 30);
    const truoc = process.memoryUsage().arrayBuffers;
    const batDau = Date.now();
    assert.equal(kiemCauTrucCfb(buf).ok, false);
    assert.ok(Date.now() - batDau < 50);
    assert.ok(process.memoryUsage().arrayBuffers - truoc < 8 * 1024 * 1024);
  });

  it("chuỗi sector vòng A -> B -> A -> hỏng", () => {
    const f = hopLe();
    const dau = f.sectorDau[0]!;
    const cuoi = dau + f.soSectorMoiStream[0]! - 1;
    f.buf.writeUInt32LE(dau, f.offsetFat + 4 * cuoi); // sector cuối trỏ ngược về đầu
    assert.equal(kiemCauTrucCfb(f.buf).ok, false);
  });

  it("hai chuỗi dùng chung đuôi (khuếch đại kiểu cfb) -> hỏng", () => {
    const f = hopLe();
    // sector đầu của stream 2 trỏ sang sector thứ 2 của stream 1
    f.buf.writeUInt32LE(f.sectorDau[0]! + 1, f.offsetFat + 4 * f.sectorDau[1]!);
    assert.equal(kiemCauTrucCfb(f.buf).ok, false);
  });

  it("hai entry thư mục chung sector đầu -> hỏng", () => {
    const f = hopLe();
    f.buf.writeUInt32LE(f.sectorDau[0]!, f.offsetThuMuc + 128 * 2 + 116);
    assert.equal(kiemCauTrucCfb(f.buf).ok, false);
  });

  it("cây thư mục có vòng (right trỏ ngược) -> hỏng thay vì đệ quy vô hạn", () => {
    const f = hopLe();
    f.buf.writeUInt32LE(1, f.offsetThuMuc + 128 * 2 + 72); // entry 2 -> right = entry 1
    assert.equal(kiemCauTrucCfb(f.buf).ok, false);
  });

  it("số sector FAT khai vượt số sector của tệp -> hỏng", () => {
    const { buf } = hopLe();
    buf.writeUInt32LE(1_000_000, 44);
    assert.equal(kiemCauTrucCfb(buf).ok, false);
  });

  it("cỡ stream khai lớn hơn chuỗi sector của nó -> hỏng", () => {
    const f = hopLe();
    f.buf.writeUInt32LE(50_000_000, f.offsetThuMuc + 128 + 120);
    assert.equal(kiemCauTrucCfb(f.buf).ok, false);
  });

  it("stream cỡ 0 trỏ vào chuỗi mini vòng (0 -> 1 -> 0) -> hỏng (word-extractor lặp vô hạn)", () => {
    // Stream cỡ 0 vẫn được word-extractor coi là "short" và duyệt chuỗi miniFAT
    // ngay khi mở - không có bộ đánh dấu đã-thăm, chỉ chặn sector tự trỏ chính nó.
    const f = taoCfb([
      { ten: "WordDocument", data: Buffer.alloc(4096, 1) },
      { ten: "1Table", data: Buffer.alloc(4096, 2) },
      { ten: "Pad", data: Buffer.alloc(4096, 0) },
    ]);
    const b = f.buf;
    b.writeUInt32LE(0xffffffff, f.offsetThuMuc + 128 * 2 + 72); // tách Pad khỏi cây
    const mf = f.sectorDau[2]!; // sector đầu của Pad thành sector miniFAT
    b.writeUInt32LE(0xfffffffe, f.offsetFat + 4 * mf);
    b.writeUInt32LE(mf, 60);
    b.writeUInt32LE(1, 64);
    b.writeUInt32LE(1, 512 * (1 + mf)); // mini 0 -> 1
    b.writeUInt32LE(0, 512 * (1 + mf) + 4); // mini 1 -> 0
    b.writeUInt32LE(0, f.offsetThuMuc + 128 + 116); // WordDocument bắt đầu ở mini 0
    b.writeUInt32LE(0, f.offsetThuMuc + 128 + 120); // ... với cỡ 0
    assert.equal(kiemCauTrucCfb(b).ok, false);
  });

  it("stream cỡ 0 bắt đầu ENDOFCHAIN (cách ghi thường gặp) vẫn hợp lệ", () => {
    const f = hopLe();
    f.buf.writeUInt32LE(0xfffffffe, f.offsetThuMuc + 128 * 2 + 116);
    f.buf.writeUInt32LE(0, f.offsetThuMuc + 128 * 2 + 120);
    // giải phóng chuỗi cũ của 1Table để không bị coi là sector mồ côi trùng
    assert.equal(kiemCauTrucCfb(f.buf).ok, true);
  });

  it("tệp ngắn hơn header hoặc sai magic -> hỏng", () => {
    assert.equal(kiemCauTrucCfb(Buffer.alloc(100)).ok, false);
    assert.equal(kiemCauTrucCfb(Buffer.alloc(2048)).ok, false);
  });
});
