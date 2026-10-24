import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hostnameToAddress, isPublicAddress } from "./private-address-guard.js";

describe("private-address-guard", () => {
  it("cho phép IPv4 public", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "203.113.190.1", "13.107.42.14", "99.83.190.102"]) {
      assert.equal(isPublicAddress(ip), true, `${ip} phải là public`);
    }
  });

  it("chặn IPv4 nội bộ, loopback, metadata cloud, CGNAT", () => {
    const blocked = [
      "127.0.0.1", // loopback - dashboard của chính bot
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.5", // private
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // metadata AWS/GCP/Azure
      "100.64.0.1", // CGNAT
      "198.18.0.1", // benchmarking
      "192.0.2.1", // documentation
      "224.0.0.1", // multicast
      "255.255.255.255",
    ];
    for (const ip of blocked) {
      assert.equal(isPublicAddress(ip), false, `${ip} phải bị chặn`);
    }
  });

  it("172.32.x.x nằm NGOÀI dải private 172.16/12 nên vẫn public", () => {
    assert.equal(isPublicAddress("172.32.0.1"), true);
    assert.equal(isPublicAddress("172.15.255.255"), true);
  });

  it("cho phép IPv6 public", () => {
    assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
    assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
  });

  it("chặn IPv6 loopback, unique-local, link-local, multicast, documentation", () => {
    const blocked = [
      "::1", // loopback
      "::", // unspecified
      "fc00::1", // unique-local
      "fd12:3456::1",
      "fe80::1", // link-local
      "fe80::1%eth0", // có zone index
      "ff02::1", // multicast
      "2001:db8::1", // documentation
      "100::1", // discard prefix
    ];
    for (const ip of blocked) {
      assert.equal(isPublicAddress(ip), false, `${ip} phải bị chặn`);
    }
  });

  it("IPv4-mapped và NAT64 bị xét theo IPv4 bên trong (không cho lách qua IPv6)", () => {
    assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
    assert.equal(isPublicAddress("::ffff:169.254.169.254"), false);
    assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
    assert.equal(isPublicAddress("64:ff9b::127.0.0.1"), false);
    assert.equal(isPublicAddress("64:ff9b::8.8.8.8"), true);
  });

  it("các dạng IPv6 bọc IPv4 khác: IPv4-translated và 6to4 xét theo IPv4 bên trong", () => {
    // Mỗi dạng thử cả viết thập phân lẫn hex - hai cách viết đi hai nhánh khác
    // nhau trong bộ bung địa chỉ.
    for (const ip of ["::ffff:0:a9fe:a9fe", "::ffff:0:169.254.169.254", "::ffff:0:7f00:1", "2002:7f00:1::", "2002:a9fe:a9fe:1::1", "2002:c0a8:101::"]) {
      assert.equal(isPublicAddress(ip), false, `${ip} phải bị chặn`);
    }
    for (const ip of ["::ffff:0:808:808", "2002:808:808::1"]) {
      assert.equal(isPublicAddress(ip), true, `${ip} bọc IPv4 public nên vẫn tải được`);
    }
  });

  it("IPv4-compatible (đã bỏ), NAT64 local-use, Teredo, site-local: chặn hẳn", () => {
    const blocked = [
      "::127.0.0.1", "::7f00:1", "::8.8.8.8", // ::/96 - kể cả IPv4 public bên trong
      "64:ff9b:1::a9fe:a9fe", "64:ff9b:1::8.8.8.8", "64:ff9b:1:ffff::1",
      "2001::1", "2001:0:4136:e378:8000:63bf:3fff:fdd2", // Teredo 2001::/32
      "fec0::1",
    ];
    for (const ip of blocked) {
      assert.equal(isPublicAddress(ip), false, `${ip} phải bị chặn`);
    }
    // 2001:4860::/32 (Google) chung hai byte đầu với Teredo nhưng KHÔNG phải Teredo
    assert.equal(isPublicAddress("2001:4860:4860::8888"), true);
    assert.equal(isPublicAddress("64:ff9b:2::1"), true, "chỉ đúng /48 local-use bị chặn");
  });

  it("chuỗi không phải IP thì không tin (false)", () => {
    for (const value of ["", "localhost", "8.8.8", "8.8.8.8.8", "999.1.1.1", "vi-pham::gg::hai"]) {
      assert.equal(isPublicAddress(value), false, `"${value}" phải bị coi là không hợp lệ`);
    }
  });

  it("hostnameToAddress bỏ ngoặc vuông của IPv6 trong URL", () => {
    assert.equal(hostnameToAddress("[::1]"), "::1");
    assert.equal(hostnameToAddress("example.com"), "example.com");
    assert.equal(hostnameToAddress("127.0.0.1"), "127.0.0.1");
  });
});
