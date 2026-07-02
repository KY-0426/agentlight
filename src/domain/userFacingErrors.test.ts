import { describe, expect, it } from "vitest";
import { formatUserFacingError } from "./userFacingErrors";

describe("formatUserFacingError", () => {
  it("maps known API errors to Chinese copy", () => {
    expect(formatUserFacingError(new Error("Invalid leaderboard query"), "失败")).toBe("请求参数有误，请刷新后重试");
    expect(formatUserFacingError(new Error("排行榜接口返回 403"), "失败")).toBe("服务暂时不可用，请稍后重试");
    expect(formatUserFacingError(new Error("Device must be activated before cloud bootstrap"), "失败")).toBe(
      "请先完成激活，再开启云端同步",
    );
  });

  it("keeps existing Chinese messages from the app layer", () => {
    expect(formatUserFacingError(new Error("请先完成激活，再开启云端同步"), "失败")).toBe("请先完成激活，再开启云端同步");
    expect(formatUserFacingError(new Error("无法连接云端，请检查网络后重试"), "失败")).toBe(
      "无法连接云端，请检查网络后重试",
    );
  });

  it("falls back for unknown English errors", () => {
    expect(formatUserFacingError(new Error("Unexpected internal server failure"), "默认失败")).toBe("默认失败");
    expect(formatUserFacingError(null, "默认失败")).toBe("默认失败");
  });
});
