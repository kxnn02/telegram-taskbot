import { describe, expect, it, vi } from "vitest";
import { pingDatabase } from "./keepAlive.js";

function fakeClient(result: { data?: unknown; error?: { message: string } | null }) {
  const limit = vi.fn().mockResolvedValue({ data: result.data ?? [], error: result.error ?? null });
  const select = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as any, from, select, limit };
}

describe("pingDatabase", () => {
  it("performs a trivial read against the database", async () => {
    const { client, from, select, limit } = fakeClient({ data: [{ cohort_id: "cohort-5" }] });

    await pingDatabase(client);

    expect(from).toHaveBeenCalledWith("cohorts");
    expect(select).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("throws when the read fails", async () => {
    const { client } = fakeClient({ error: { message: "connection refused" } });

    await expect(pingDatabase(client)).rejects.toThrow(/connection refused/);
  });
});
