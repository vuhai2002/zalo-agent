import type { KbSourceStatus } from "../dashboard-api-client";
import { nenHenLuotKe, type KetQuaTaiNguon } from "./kb-poll-guard";

const CHU_KY_MS = 4000;

/**
 * Phụ thuộc TIÊM VÀO thay vì gọi thẳng `window.setTimeout`/`window.clearTimeout`
 * - để vòng lặp test được bằng "đồng hồ giả" (fake clock tự viết, KHÔNG cần
 * `@testing-library/react`/jsdom). Component thật truyền
 * `window.setTimeout`/`window.clearTimeout`; test truyền một lịch giả đồng bộ.
 */
export type VongPollDeps<T extends { trangThai: KbSourceStatus }> = {
  /**
   * Một lần thử tải - THUẦN, không side effect. `motLuot` tự quyết định có
   * ÁP DỤNG kết quả này vào UI hay không (xem `apDung`) trước khi dùng nó để
   * tính lịch tiếp theo.
   */
  tai: () => Promise<KetQuaTaiNguon<T>>;
  /**
   * Áp UI (setSources/setLoadError...) - `motLuot` CHỈ gọi hàm này khi lượt
   * vừa tải xong vẫn còn là lượt MỚI NHẤT (chiều 7). Tách khỏi `tai` để hai
   * lượt tải bay chồng nhau, về ĐẢO THỨ TỰ (lượt cũ về sau lượt mới), không
   * làm UI lùi lại bản cũ - lượt cũ không bao giờ chạm tới `apDung`.
   */
  apDung: (ketQua: KetQuaTaiNguon<T>) => void;
  henGio: (chay: () => void | Promise<void>, ms: number) => unknown;
  xoaGio: (tayCam: unknown) => void;
};

/**
 * Vòng lặp poll THUẦN, tách khỏi React. Khóa đủ TÁM bất biến mà `setInterval`
 * gốc và các bản `setTimeout` tiền nhiệm (83ffc5d, 07d726c, b342d1a, 427d28f)
 * đều phải giữ (xem report phase 06 - rà soát vòng 2 tới vòng 5):
 *
 *   1. Còn việc thì hẹn tiếp
 *   2. Hết việc thì dừng (B7)
 *   3. Unmount thì dọn (`dungHan`)
 *   4. Tải hỏng vẫn hẹn nếu lượt trước đã biết còn việc (Important 1)
 *   5. Không hẹn CHỒNG timer (`reload` xóa timer đang chờ TRƯỚC khi tải lại)
 *   6. Poll ĐÃ DỪNG (hết việc) rồi có việc MỚI (`reload` sau khi thêm nguồn,
 *      bấm "Xử lý lại") thì TỰ KHỞI ĐỘNG LẠI
 *   7. CHỐNG TÁI NHẬP - hai lượt `motLuot` bay chồng nhau không được đè lịch
 *      của nhau
 *   8. Lượt CŨ về muộn vẫn được GHI SỔ "còn việc" nếu nó mới hơn lần ghi sổ
 *      gần nhất - dù không còn là lượt được ÁP UI/HẸN GIỜ
 *
 * Bug hồi quy vừa sửa (07d726c): `reload()` gọi thẳng MỘT lần tải, không đi
 * qua `motLuot` - một khi vòng lặp đã dừng (mọi nguồn `san_sang`/`hong`, tức
 * TRẠNG THÁI NGHỈ BÌNH THƯỜNG của trang), không còn gì hồi sinh nó: thêm
 * nguồn mới hay bấm "Xử lý lại" đều rơi vào ngõ cụt, badge/bảng đứng im tới
 * khi F5. `reload()` và `batDau()` ở đây đều gọi ĐÚNG `motLuot` - "làm mới
 * ngay" và "vòng lặp tự động" là HAI LỐI VÀO của CÙNG một cỗ máy, không phải
 * hai cơ chế tách rời.
 *
 * Bug hồi quy #4 vừa sửa (chiều 7, `427d28f`): cho `reload` đi qua `motLuot`
 * mở đường cho HAI lượt bay song song (vd `reindex` hai dòng hỏng liên tiếp,
 * hoặc click "Xử lý lại"/thêm nguồn đúng lúc lượt poll định kỳ chưa về). Việc
 * hủy timer nằm TRƯỚC `await deps.tai()`, còn việc GHI `timerId` nằm SAU
 * await và không kiểm lại - lượt về SAU ghi đè `timerId`, bỏ rơi timer của
 * lượt về TRƯỚC (mồ côi, vẫn sống, bắn cả sau khi `dungHan()` đã chạy); và
 * nếu `tai` tự đụng UI, hai lần tải về ĐẢO THỨ TỰ làm UI lùi lại bản cũ.
 * `the`/`cuaToi` (mã thế hệ) là chốt tái nhập: lượt mới luôn vô hiệu hoá MỌI
 * lượt đang bay, lượt cũ về muộn tự biết mình lỗi thời - không được ÁP UI,
 * không được HẸN GIỜ.
 *
 * Bug hồi quy #5 vừa sửa (chiều 8): chốt tái nhập ở trên chặn lượt cũ TRƯỚC
 * cả bước ghi `sourcesDaBiet` - lượt cũ về muộn không chỉ mất quyền áp UI
 * (đúng ý đồ) mà còn mất quyền GHI SỔ "server vừa nói còn việc". Một lượt MỚI
 * hơn nhưng THẤT BẠI (mất mạng/502) thì `nenHenLuotKe` của nó rơi về ảnh chụp
 * CŨ HƠN lượt vừa bị chặn ghi (hoặc `null`) -> `false` -> KHÔNG hẹn gì - biến
 * "còn sống nhưng rò 1 timer" (bug chiều 7, đã đo ở bản `427d28f`) thành
 * "chết hẳn". `theDaGhi` tách "ai được coi là lượt hiện hành" (chiều 7, quyết
 * định ÁP UI/HẸN GIỜ) khỏi "tri thức còn việc hay không" (chiều 8, một sự
 * thật về THẾ GIỚI không thuộc riêng lượt nào) - ghi sổ chỉ cấm bị lượt CŨ HƠN
 * lần ghi gần nhất ghi đè, không cấm lượt không còn là "hiện hành" ghi.
 */
export function taoVongPoll<T extends { trangThai: KbSourceStatus }>(deps: VongPollDeps<T>) {
  let timerId: unknown = null;
  let sourcesDaBiet: T[] | null = null;
  let huy = false;
  let the = 0;
  // Chiều 8: thế hệ CUỐI CÙNG đã thật sự GHI vào `sourcesDaBiet` - tách khỏi
  // `the` (thế hệ đang là lượt MỚI NHẤT). Hai việc khác nhau: "ai được coi là
  // lượt hiện hành" (áp UI, hẹn giờ) và "tri thức còn việc hay không" là một
  // sự thật về THẾ GIỚI, không thuộc về riêng lượt nào - một lượt CŨ về muộn
  // vẫn phải được phép ghi sổ nếu nó mới hơn lần ghi sổ gần nhất.
  let theDaGhi = 0;

  async function motLuot(): Promise<void> {
    const cuaToi = ++the; // Chiều 7: lượt mới vô hiệu hoá mọi lượt đang bay
    // Chiều 5: một lượt MỚI bắt đầu (dù do hẹn giờ tự bắn hay do reload() gọi
    // tay) làm lượt hẹn CŨ (nếu còn) lỗi thời ngay lập tức - không bao giờ để
    // hai timer cùng chờ chồng lên nhau.
    if (timerId !== null) {
      deps.xoaGio(timerId);
      timerId = null;
    }
    const ketQua = await deps.tai();
    // Chiều 8: ghi sổ "còn việc" TRƯỚC chốt tái nhập, chỉ cấm GHI ĐÈ bởi một
    // lượt cũ hơn lượt đã ghi gần nhất (`cuaToi > theDaGhi`, không phải
    // `cuaToi === the`) - nếu không, một lượt CŨ về muộn nhưng vẫn còn hợp lệ
    // (chạy TRƯỚC một lượt MỚI hơn vừa thất bại) sẽ bị chốt tái nhập chặn
    // trước khi kịp báo "server vừa nói còn việc", và `nenHenLuotKe` của lượt
    // thất bại rơi về ảnh chụp cũ hơn (hoặc `null`) -> không hẹn gì, poll CHẾT
    // hẳn thay vì chỉ rò một timer như bản trước khi có chốt tái nhập.
    if (ketQua.thanhCong && cuaToi > theDaGhi) {
      sourcesDaBiet = ketQua.items;
      theDaGhi = cuaToi;
    }
    // Chiều 7: lượt cũ về muộn (đã có lượt mới hơn chạy sau nó) thì KHÔNG áp
    // UI, KHÔNG hẹn gì - nếu không, hai lần tải về đảo thứ tự sẽ làm UI lùi
    // lại bản cũ, và `timerId` bị ghi đè hai lần liên tiếp làm timer của lượt
    // đầu mồ côi.
    if (huy || cuaToi !== the) return;
    deps.apDung(ketQua);
    // Chiều 1/2/4/6 đều quyết định ở ĐÚNG MỘT chỗ này - `nenHenLuotKe` xét cả
    // nhánh thành công lẫn thất bại, và vì `reload`/`batDau` cùng chạy hàm
    // này, "poll đã dừng rồi có việc mới" (chiều 6) tự động hẹn lại được.
    if (nenHenLuotKe(ketQua, sourcesDaBiet)) {
      timerId = deps.henGio(motLuot, CHU_KY_MS);
    }
  }

  return {
    /** Gọi lúc mount - bắt đầu vòng lặp lần đầu */
    batDau: (): Promise<void> => motLuot(),
    /**
     * Làm mới NGAY theo hành động chủ động của người dùng (thêm nguồn, bấm
     * "Xử lý lại", xóa nguồn) - ĐI QUA ĐÚNG `motLuot`, không phải một lần tải
     * trần, để chiều 6 (tự khởi động lại sau khi đã dừng) luôn đúng.
     */
    reload: (): Promise<void> => motLuot(),
    /** Gọi lúc unmount - dọn timer đang chờ (nếu có), chặn mọi lượt còn dang dở */
    dungHan: (): void => {
      huy = true;
      if (timerId !== null) {
        deps.xoaGio(timerId);
        timerId = null;
      }
    },
  };
}
