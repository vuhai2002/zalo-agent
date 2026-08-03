import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TUNING_DEFS, TUNING_GROUPS } from "./tuning-definitions.js";

/**
 * Id nhóm KHÔNG còn là nhãn nội bộ: nó là đoạn URL của trang Cấu hình
 * (`/tuning/:nhom`) và là khóa để trình duyệt gắn các khối không-phải-tham-số
 * vào đúng nhóm. Đổi một id ở đây mà quên sửa bên web thì hỏng IM LẶNG - nhóm
 * mất icon, hoặc mất hẳn form nhà cung cấp / khối đổi mật khẩu, mà không có
 * lỗi biên dịch nào vì hai bên nối nhau bằng chuỗi.
 */

/** Nhóm mà web gắn thêm khối riêng vào - khớp hằng số trong `tuning-page.tsx` */
const NHOM_CO_KHOI_RIENG = ["providers", "general"];

describe("TUNING_GROUPS", () => {
  it("id nhóm dùng được làm đoạn URL", () => {
    for (const g of TUNING_GROUPS) {
      assert.match(g.id, /^[a-z][a-z0-9-]*$/, `id "${g.id}" không phải slug URL an toàn`);
      assert.equal(encodeURIComponent(g.id), g.id, `id "${g.id}" phải đổi mã khi lên URL`);
    }
  });

  it("id nhóm không trùng nhau", () => {
    const ids = TUNING_GROUPS.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length, `có id trùng: ${ids.join(", ")}`);
  });

  it("mọi tham số trỏ tới một nhóm CÓ THẬT", () => {
    const ids = new Set(TUNING_GROUPS.map((g) => g.id));
    for (const [key, def] of Object.entries(TUNING_DEFS)) {
      assert.ok(ids.has(def.group), `${key} thuộc nhóm "${def.group}" không tồn tại`);
    }
  });

  it("các nhóm web gắn khối riêng vào đều còn tồn tại", () => {
    const ids = new Set(TUNING_GROUPS.map((g) => g.id));
    for (const id of NHOM_CO_KHOI_RIENG) {
      assert.ok(ids.has(id), `mất nhóm "${id}" - web sẽ không hiện được khối gắn vào nó`);
    }
  });

  it("nhóm providers cố ý KHÔNG có tham số nào - nội dung là form riêng bên web", () => {
    const cua = Object.values(TUNING_DEFS).filter((d) => d.group === "providers");
    assert.equal(cua.length, 0, "thêm tham số vào nhóm này là sai: 4 ô nhà cung cấp phải lưu cùng lúc");
  });

  it("mọi nhóm KHÁC đều có ít nhất một tham số - nhóm rỗng là mục nav bấm vào trống trơn", () => {
    const dem = new Map(TUNING_GROUPS.map((g) => [g.id, 0]));
    for (const def of Object.values(TUNING_DEFS)) dem.set(def.group, (dem.get(def.group) ?? 0) + 1);
    for (const g of TUNING_GROUPS) {
      if (NHOM_CO_KHOI_RIENG.includes(g.id) && g.id === "providers") continue;
      assert.ok((dem.get(g.id) ?? 0) > 0, `nhóm "${g.id}" không có tham số nào`);
    }
  });

  it("nhóm đầu tiên là providers - việc phải làm trước tiên khi cài mới", () => {
    assert.equal(TUNING_GROUPS[0]?.id, "providers");
  });
});
