/**
 * Giới hạn số tệp đính kèm đang GIỮ BYTE trong RAM cùng lúc: tối đa `toiDa`
 * trên cả tiến trình, `toiDaMoiKey` cho mỗi người gửi.
 *
 * Vì sao cần, dù đã có hàng đợi trích xuất 1 chỗ: hàng đợi đó chỉ xếp phần
 * TRÍCH, còn byte đã tải về nằm sẵn trong closure chờ tới lượt. Một người lạ
 * gửi 30 tệp 20 MB là 30 lượt tải chạy song song rồi 600 MB Buffer ngồi chờ
 * trong container 768 MB - tiến trình cha OOM, mọi account chết theo. Giữ lượt
 * TRƯỚC khi tải thì byte chỉ tồn tại khi sắp được xử lý. Trần mỗi người gửi là
 * để một người dội tệp không chiếm hết cả hai chỗ: người khác vẫn còn chỗ kia.
 *
 * Người chờ chỉ giữ một closure nhỏ, không giữ byte - danh sách chờ dài không
 * tốn RAM đáng kể.
 */

export type GioiHanLuotTai = {
  /** Chờ tới lượt; trả hàm NHẢ (gọi nhiều lần cũng chỉ nhả một lần) */
  giu(key: string): Promise<() => void>;
  trangThai(): { dangChay: number; dangCho: number };
};

export function taoGioiHanLuotTai(o: { toiDa: number; toiDaMoiKey: number }): GioiHanLuotTai {
  let dangChay = 0;
  const theoKey = new Map<string, number>();
  const cho: { key: string; vao: () => void }[] = [];

  const duocVao = (key: string) => dangChay < o.toiDa && (theoKey.get(key) ?? 0) < o.toiDaMoiKey;

  function chiemCho(key: string): () => void {
    dangChay++;
    theoKey.set(key, (theoKey.get(key) ?? 0) + 1);
    let daNha = false;
    return () => {
      if (daNha) return;
      daNha = true;
      dangChay--;
      const con = theoKey.get(key)! - 1;
      if (con === 0) theoKey.delete(key);
      else theoKey.set(key, con);
      moTiep();
    };
  }

  // FIFO nhưng bỏ qua người chờ mà người gửi đó đang giữ đủ chỗ - không thì
  // tệp thứ 2 của người dội tệp chặn đầu hàng, người khác chờ oan
  function moTiep(): void {
    for (let i = 0; i < cho.length && dangChay < o.toiDa; ) {
      if (duocVao(cho[i]!.key)) cho.splice(i, 1)[0]!.vao();
      else i++;
    }
  }

  return {
    giu(key) {
      if (duocVao(key)) return Promise.resolve(chiemCho(key));
      return new Promise((resolve) => cho.push({ key, vao: () => resolve(chiemCho(key)) }));
    },
    trangThai: () => ({ dangChay, dangCho: cho.length }),
  };
}
