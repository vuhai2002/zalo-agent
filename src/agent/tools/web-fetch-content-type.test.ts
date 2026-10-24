import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { laNoiDungHtml } from "./web-fetch-content-type.js";

// Module thuần - import tĩnh được, không cần setupTestEnv

describe("laNoiDungHtml", () => {
  it("content-type HTML (và octet-stream như trước) là HTML", () => {
    assert.equal(laNoiDungHtml("text/html", "x"), true);
    assert.equal(laNoiDungHtml("application/xhtml+xml", "x"), true);
    assert.equal(laNoiDungHtml("application/octet-stream", "x"), true);
  });

  it("text/plain mà thân là trang HTML thật thì vẫn qua bộ bóc HTML", () => {
    assert.equal(laNoiDungHtml("text/plain", "<!DOCTYPE html><html><body>"), true);
    assert.equal(laNoiDungHtml("text/plain", "﻿\n  <html lang=vi><div hidden>x</div>"), true);
    assert.equal(laNoiDungHtml("TEXT/PLAIN", "<HTML>"), true);
  });

  it("text/plain thường - kể cả có nhắc tới thẻ HTML ở giữa - vẫn là văn bản", () => {
    assert.equal(laNoiDungHtml("text/plain", "Hướng dẫn: viết <html> ở đầu file"), false);
    assert.equal(laNoiDungHtml("text/plain", "giá vàng hôm nay"), false);
  });

  it("loại khác (json, markdown) không đổi hành vi dù thân trông như HTML", () => {
    assert.equal(laNoiDungHtml("application/json", "<html>"), false);
    assert.equal(laNoiDungHtml("text/markdown", "<!doctype html>"), false);
  });
});
