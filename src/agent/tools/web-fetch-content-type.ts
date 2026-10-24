/**
 * Thân trả về có phải HTML không - quyết định `web_fetch` có cho qua bộ bóc
 * HTML (`htmlToReadableText`, gồm bước bỏ phần tử ẩn) hay đưa nguyên văn.
 *
 * Tin `content-type` là chính, nhưng `text/plain` thì còn soi phần đầu thân:
 * server khai `text/plain` mà trả trang HTML đầy đủ thì trước đây toàn bộ markup
 * - kể cả khối `hidden`/`display:none` mà bộ bóc sinh ra để gỡ - đi thẳng vào
 * model. Chỉ nhận dấu hiệu RÕ (`<!doctype html`, `<html`) ở ĐẦU thân: văn bản
 * thường có nhắc tới thẻ HTML ở giữa (bài hướng dẫn, đoạn code) vẫn là văn bản.
 *
 * Module THUẦN (không logger) để test được mà không đụng `DATA_DIR`.
 */
export function laNoiDungHtml(mediaType: string, raw: string): boolean {
  const loai = mediaType.toLowerCase();
  if (loai.includes("html") || loai === "application/octet-stream") return true;
  if (loai !== "text/plain") return false;
  // Bỏ BOM + khoảng trắng đầu; chỉ soi 64 ký tự đầu - đủ cho cả hai dấu hiệu
  const dau = raw.slice(0, 256).replace(/^﻿/, "").trimStart().slice(0, 64).toLowerCase();
  return dau.startsWith("<!doctype html") || dau.startsWith("<html");
}
