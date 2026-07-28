import { getPolicyForOwner } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { normalizeOwnerAddress } from "@/lib/wallet/owner";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const ownerRaw = url.searchParams.get("owner")?.trim();
    if (!ownerRaw) {
      return jsonOk({ error: "owner query param required (wallet address)" }, 400);
    }
    const ownerAddress = normalizeOwnerAddress(ownerRaw);
    const policy = await getPolicyForOwner(id, ownerAddress);
    if (!policy) {
      return jsonOk({ error: "Policy not found" }, 404);
    }
    return jsonOk({
      policyId: policy.id,
      name: policy.name,
      recipients: policy.recipients,
      ownerAddress: policy.ownerAddress,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    });
  } catch (err) {
    return jsonError(err);
  }
}
