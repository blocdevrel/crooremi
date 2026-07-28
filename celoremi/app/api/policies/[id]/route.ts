import { getPolicy } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const policy = await getPolicy(id);
    if (!policy) {
      return jsonOk({ error: "Policy not found" }, 404);
    }
    return jsonOk({
      policyId: policy.id,
      name: policy.name,
      recipients: policy.recipients,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    });
  } catch (err) {
    return jsonError(err);
  }
}
