# Phase 05 - Chống lạm dụng API và sửa test hụt

**Ưu tiên:** trung bình cao. Không có lỗ vượt quyền, nhưng có hai đường OOM chỉ
bằng một request, và một test hụt là biện pháp chặn rủi ro số 1 của kế hoạch gốc.
**Trạng thái:** chưa làm. **Độc lập** với 01-04.

## Bối cảnh

- File: `src/server/routes/kb-routes.ts`, `src/knowledge/chunk-text.test.ts`,
  `src/server/routes/kb-routes.test.ts`.
- Mẫu chặn trần body sẵn có: `kb-routes.ts` route `POST /sources/text` đã có
  `chanTranDungLuong` kèm comment giải thích vì sao bắt buộc.

## Lỗi phải đóng

| Mã | Lỗi | Số đo |
|---|---|---|
| I10 | `PUT /agents/:agentId/sources` thiếu `chanTranDungLuong` | body 100MB -> 400 sau khi RSS đã lên **1346 MB** (container 768M). `.max(500)` không giới hạn ĐỘ DÀI từng chuỗi |
| I11 | `ten` của route upload file không có trần độ dài | `ten` 2 triệu ký tự -> 202, lưu nguyên vào DB. Tên đi vào MỌI kết quả `kb_search` |
| I9 | TOCTOU giữa `getAgent` và `await c.req.json()` | agent bị xóa trong khoảng await thì `datNguonChoAgent` vẫn ghi -> gán mồ côi hồi sinh được |
| I14 | **Test hụt thứ TÁM** | thay toàn bộ thân `viTriCatTotNhat` bằng `return maxLen` mà cả 6 test `chunk-text.test.ts` vẫn XANH |
| I16 | Test auth bỏ sót `POST /api/kb/sources/file` | route DUY NHẤT ghi ra đĩa |

## Nhận định then chốt

**I14 là lỗi của controller, không phải của implementer.** Commit `ed7b771` sửa
KHẲNG ĐỊNH của test (đổi sang so danh sách từ) mà không sửa ĐẦU VÀO: đầu vào là
`coDoanToiDa: 37` trên hai đoạn văn dài 20 và 25 ký tự, nên vòng
`while (con.length > maxLen)` trong `catVanBanPhang` KHÔNG BAO GIỜ chạy và
`viTriCatTotNhat` không được gọi lần nào. Controller duyệt qua.

Bài học áp cho cả phase: **sửa test phải chứng minh đường code cần đo THẬT SỰ
được chạy**, không chỉ đọc màu xanh/đỏ.

**Trần body cho `PUT` không thay được trần phần tử.** Cần cả hai: `chanTranDungLuong`
chặn ở tầng đọc, và `.max()` cho ĐỘ DÀI từng `sourceId` (id là hex 16 ký tự, cho
64 là thừa).

## File

**Sửa:**
- `src/server/routes/kb-routes.ts` - trần body cho `PUT`, trần độ dài phần tử,
  `ten` của route file dùng cùng schema với route text, đảo thứ tự kiểm agent
- `src/knowledge/chunk-text.test.ts` - sửa ĐẦU VÀO cho test ranh giới
- `src/server/routes/kb-routes.test.ts` - phủ nốt route file trong test auth

## Các bước

- [ ] **B1: Sửa test hụt thứ tám - ĐẦU VÀO trước, khẳng định sau**

```ts
it("cắt ở ranh giới tự nhiên, KHÔNG cắt giữa từ", () => {
  // ĐẦU VÀO phải làm `viTriCatTotNhat` thật sự được gọi: một đoạn văn dài hơn
  // hẳn coDoanToiDa. Bản trước dùng coDoanToiDa 37 trên đoạn 20 và 25 ký tự nên
  // vòng cắt không chạy lần nào và test không đo được gì.
  const cau = "Chính sách đổi trả áp dụng cho mọi đơn hàng mua tại cửa hàng trong vòng bảy ngày kể từ ngày nhận. ";
  const chu = cau.repeat(4);                       // ~400 ký tự, một đoạn văn liền
  const d = catThanhDoan(chu, { coDoanToiDa: 60, chongLan: 0 });

  assert.ok(d.length >= 5, `chỉ ra ${d.length} đoạn - vòng cắt có thể không chạy`);
  const tuGoc = chu.split(/\s+/).filter(Boolean);
  const tuSauKhiCat = d.flatMap((x) => x.noiDung.split(/\s+/)).filter(Boolean);
  assert.deepEqual(tuSauKhiCat, tuGoc, "có từ bị xé làm đôi ở mối nối");
});
```

Khẳng định `d.length >= 5` là chốt chống lặp lại chính lỗi này: nếu ai đó lại đổi
đầu vào thành chuỗi ngắn, test tự báo thay vì âm thầm không đo gì.

- [ ] **B2: Chạy phép phá NGAY để chứng minh test mới không hụt**

Thay toàn bộ thân `viTriCatTotNhat` bằng `return maxLen`. Test B1 phải ĐỎ, và đỏ
vì lý do "có từ bị xé làm đôi" chứ không phải vì số đoạn. Dán output đỏ vào report.
Nếu nó KHÔNG đỏ, dừng lại và báo - đừng đi tiếp.

- [ ] **B3: Test đỏ trước - trần body cho `PUT`**

```ts
it("PUT gán nguồn với body khổng lồ bị chặn ở TẦNG ĐỌC, không nuốt hết vào RAM", async () => {
  tuning.setTuning("KB_MAX_FILE_MB", 1);
  const than = JSON.stringify({ sourceIds: Array.from({ length: 400 }, () => "x".repeat(8000)) });
  const res = await app.request("/api/kb/agents/a1/sources", {
    method: "PUT", body: than, headers: { cookie, "content-type": "application/json" },
  });
  assert.equal(res.status, 413);
});

it("từng phần tử sourceIds có trần độ dài", async () => {
  const res = await guiJson("/api/kb/agents/a1/sources", "PUT", { sourceIds: ["x".repeat(200)] });
  assert.equal(res.status, 400);
});
```

- [ ] **B4: Test đỏ trước - `ten` của route file có trần**

```ts
it("upload file với ten quá dài bị từ chối 400", async () => {
  // Đã đo: ten 2 triệu ký tự -> 202, lưu nguyên vào DB, rồi đi vào MỌI kết quả
  // kb_search. Route gõ tay ngay bên cạnh đã có .max(200).
  const res = await app.request("/api/kb/sources/file", {
    method: "POST", body: formFile("a".repeat(201), Buffer.from("x")), headers: { cookie },
  });
  assert.equal(res.status, 400);
  assert.equal(store.danhSachNguon().length, 0);
});

it("ten đúng 200 ký tự VẪN qua - ghim biên", async () => {
  const res = await app.request("/api/kb/sources/file", {
    method: "POST", body: formFile("a".repeat(200), Buffer.from("x")), headers: { cookie },
  });
  assert.equal(res.status, 202);
});
```

Ca "đúng 200 vẫn qua" là chốt ghim biên - thiếu nó thì `.max(150)` cũng xanh.

- [ ] **B5: Test đỏ trước - TOCTOU**

```ts
it("agent bị xóa giữa lúc PUT đang đọc body thì KHÔNG ghi gán mồ côi", async () => {
  // getAgent chạy TRƯỚC await c.req.json(). Agent biến mất trong khoảng đó thì
  // datNguonChoAgent vẫn ghi - lách qua chính phép dọn ở deleteAgent.
  // Kiểm agent tồn tại phải nằm SAU khi parse xong, hoặc kiểm lại lần nữa ngay
  // trước khi ghi.
  assert.deepEqual(binding.nguonCuaAgent("da-xoa"), []);
});
```

Nếu không dựng được cửa sổ đua trong test một cách tin cậy, thay bằng test khẳng
định THỨ TỰ: kiểm agent nằm sau `await c.req.json()` trong code. Ghi rõ lựa chọn
vào report.

- [ ] **B6: Test đỏ trước - auth phủ nốt route file**

```ts
it("mọi route KB đều đòi đăng nhập, KỂ CẢ route ghi ra đĩa", async () => {
  const duong = [["GET", "/api/kb/sources"], ["POST", "/api/kb/sources/text"],
                 ["POST", "/api/kb/sources/file"],           // route DUY NHẤT ghi đĩa, trước đây bỏ sót
                 ["POST", "/api/kb/sources/x/reindex"], ["DELETE", "/api/kb/sources/x"],
                 ["GET", "/api/kb/agents/a/sources"], ["PUT", "/api/kb/agents/a/sources"]] as const;
  for (const [m, p] of duong) {
    assert.equal((await app.request(p, { method: m })).status, 401, `${m} ${p} không đòi đăng nhập`);
  }
});
```

- [ ] **B7: Viết code, `pnpm typecheck` + `pnpm test`**

- [ ] **B8: Phá code kiểm 6 chốt**

| Phá gì | Test phải đỏ | Đường code được chạy |
|---|---|---|
| `viTriCatTotNhat` trả `maxLen` (cắt cứng) | "KHÔNG cắt giữa từ" | vòng `while (con.length > maxLen)` |
| Bỏ `chanTranDungLuong` khỏi `PUT` | "chặn ở TẦNG ĐỌC" | middleware |
| Bỏ `.max()` độ dài phần tử | "từng phần tử có trần độ dài" | schema Zod |
| Bỏ trần `ten` ở route file | "ten quá dài bị từ chối" | schema route file |
| Đặt `.max(150)` cho `ten` | "ten đúng 200 VẪN qua" | ghim biên |
| Đưa `getAgent` lại lên trước `await` | test TOCTOU | thứ tự trong handler |

- [ ] **B9: Commit**

```
fix(kb): trần body và trần tên cho route KB, sửa test ranh giới cắt đoạn
```

## Định nghĩa hoàn thành

- Không route KB nào nuốt body không giới hạn.
- `ten` có trần ở CẢ hai route, biên được ghim.
- Test ranh giới cắt đoạn thật sự đo được - đã chứng minh bằng phép phá ở B2.
- Test auth phủ đủ 7 route.
- 6/6 phép phá đỏ đúng chỗ.

## Rủi ro

| Rủi ro | Chặn thế nào |
|---|---|
| Test TOCTOU không dựng được cửa sổ đua tin cậy | B5 cho phép thay bằng test thứ tự, miễn ghi rõ lựa chọn |
| Trần `ten` 200 chặn nhầm tên file thật | Tên file dài 200 ký tự là bất thường; route gõ tay đã dùng con số này |
| Đổi schema route file làm hỏng test upload sẵn có | Chạy full suite ở B7 |

## Bước tiếp

Phase 06 sửa các ngõ cụt trên dashboard.
