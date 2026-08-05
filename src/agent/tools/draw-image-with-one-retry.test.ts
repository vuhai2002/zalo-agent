import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LoiVeHutAnh } from "../../images/image-retry-policy.js";
import type { GeneratedImage, GenerateImageParams } from "../../images/image-generation-client.js";
import { veVoiMotLanThuLai } from "./draw-image-with-one-retry.js";

const ANH: GeneratedImage = { data: Buffer.from([0xff, 0xd8]), ext: "jpg" };
const THAM_SO: GenerateImageParams = { prompt: "một con mèo đội mũ" };

/** Provider giả: ném theo kịch bản đã xếp, hết kịch bản thì trả ảnh */
function providerTheoKichBan(kichBan: (Error | null)[]) {
  const lanGoi: GenerateImageParams[] = [];
  const generate = async (params: GenerateImageParams): Promise<GeneratedImage> => {
    lanGoi.push(params);
    const loi = kichBan.shift();
    if (loi) throw loi;
    return ANH;
  };
  return { generate, lanGoi };
}

describe("veVoiMotLanThuLai", () => {
  it("chạy ngon thì gọi provider ĐÚNG MỘT lần và KHÔNG nhắn gì thêm", async () => {
    const { generate, lanGoi } = providerTheoKichBan([]);
    const baoDaGoi: string[] = [];

    const ket = await veVoiMotLanThuLai(generate, THAM_SO, () => {
      baoDaGoi.push("bao");
    });

    assert.equal(ket, ANH);
    assert.equal(lanGoi.length, 1);
    assert.deepEqual(baoDaGoi, [], "vẽ được ngay mà vẫn nhắn 'đang thử lại' là nói dối người dùng");
  });

  it("hụt ảnh lần đầu -> BÁO rồi vẽ lại, và lần hai được thì trả ảnh", async () => {
    const { generate, lanGoi } = providerTheoKichBan([new LoiVeHutAnh("Provider không trả về ảnh")]);
    const baoDaGoi: string[] = [];

    const ket = await veVoiMotLanThuLai(generate, THAM_SO, () => {
      baoDaGoi.push("bao");
    });

    assert.equal(ket, ANH);
    assert.equal(lanGoi.length, 2, "phải gọi lại provider, không phải trả lỗi luôn");
    assert.equal(baoDaGoi.length, 1, "người dùng đã đợi hơn 2 phút, thử lại âm thầm là bắt họ ngồi im tiếp");
  });

  it("báo TRƯỚC khi gọi lại, không phải sau - báo sau thì khỏi báo", async () => {
    const thuTu: string[] = [];
    const generate = async (): Promise<GeneratedImage> => {
      thuTu.push("goi-provider");
      if (thuTu.filter((x) => x === "goi-provider").length === 1) {
        throw new LoiVeHutAnh("Provider không trả về ảnh");
      }
      return ANH;
    };

    await veVoiMotLanThuLai(generate, THAM_SO, () => {
      thuTu.push("bao");
    });

    assert.deepEqual(thuTu, ["goi-provider", "bao", "goi-provider"]);
  });

  it("giữ NGUYÊN tham số ở lần vẽ lại - đổi prompt là vẽ một tấm khác", async () => {
    const thamSoDayDu: GenerateImageParams = {
      prompt: "poster tiếng Việt",
      refImage: { base64: "AAAA", mediaType: "image/png" },
      transparentBackground: true,
    };
    const { generate, lanGoi } = providerTheoKichBan([new LoiVeHutAnh("hụt")]);

    await veVoiMotLanThuLai(generate, thamSoDayDu, () => {});

    assert.deepEqual(lanGoi[0], thamSoDayDu);
    assert.deepEqual(lanGoi[1], thamSoDayDu);
  });

  it("lỗi KHÁC lớp thì không gọi lại, và lỗi gốc bay ra nguyên vẹn", async () => {
    const quaHan = new Error("Vẽ ảnh quá lâu (hơn 600 giây) nên đã dừng");
    const { generate, lanGoi } = providerTheoKichBan([quaHan]);
    const baoDaGoi: string[] = [];

    await assert.rejects(
      () => veVoiMotLanThuLai(generate, THAM_SO, () => void baoDaGoi.push("bao")),
      (err) => err === quaHan,
    );

    assert.equal(lanGoi.length, 1, "quá hạn mà gọi lại là tiêu thêm trọn một trần thời gian nữa");
    assert.deepEqual(baoDaGoi, [], "không thử lại thì đừng hứa là đang thử lại");
  });

  it("hụt CẢ HAI lần -> dừng ở hai, để lỗi lần hai bay ra cho tool nói thật", async () => {
    const lanHai = new LoiVeHutAnh("Provider không trả về ảnh (lần hai)");
    const { generate, lanGoi } = providerTheoKichBan([new LoiVeHutAnh("lần một"), lanHai]);

    await assert.rejects(
      () => veVoiMotLanThuLai(generate, THAM_SO, () => {}),
      (err) => err === lanHai,
    );

    assert.equal(lanGoi.length, 2, "thử lại lần ba là kéo người dùng chờ tới 6 phút");
  });

  it("nhắn hụt KHÔNG được làm chết lượt vẽ - gửi được ảnh quý hơn gửi được lời nhắn", async () => {
    const { generate, lanGoi } = providerTheoKichBan([new LoiVeHutAnh("hụt")]);

    const ket = await veVoiMotLanThuLai(generate, THAM_SO, () => {
      throw new Error("Zalo chối tin nhắn");
    });

    assert.equal(ket, ANH);
    assert.equal(lanGoi.length, 2);
  });
});
