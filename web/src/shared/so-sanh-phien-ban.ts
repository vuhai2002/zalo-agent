/**
 * So sánh phiên bản semver dạng "x.y.z" để quyết định có hiện nút cập nhật ở
 * chân sidebar hay không. So ba số MAJOR.MINOR.PATCH theo SỐ (nên 0.10.0 lớn
 * hơn 0.2.0, không phải so chuỗi), bỏ tiền tố "v" nếu có, và bỏ hậu tố
 * prerelease/build ("0.3.0-beta" -> lõi "0.3.0").
 *
 * Bất cứ đầu vào nào không phân tích được (null/rỗng/chữ/thiếu phần) đều trả
 * false: thà KHÔNG hiện nút còn hơn hiện một lời nhắc cập nhật sai.
 */
export function coBanMoiHon(hienTai: string, moiNhat: string | null | undefined): boolean {
  const a = phanTich(hienTai);
  const b = phanTich(moiNhat);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return true;
    if (b[i] < a[i]) return false;
  }
  return false;
}

function phanTich(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null;
  const khongV = raw.trim().replace(/^v/i, "");
  // Lấy phần lõi trước hậu tố prerelease/build: "0.3.0-beta.1" -> "0.3.0"
  const loi = khongV.split(/[-+]/)[0];
  const phan = loi.split(".");
  if (phan.length < 3) return null;
  const so: number[] = [];
  for (let i = 0; i < 3; i++) {
    const n = Number(phan[i]);
    if (!Number.isInteger(n) || n < 0) return null;
    so.push(n);
  }
  return [so[0], so[1], so[2]];
}
