import { z } from "zod";
import { createPolicy, listPolicies } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { interpretPolicyFromInput } from "@/lib/policy/interpret";
import { serviceDiscover } from "@/lib/service-discover";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("discover") === "1") {
    return serviceDiscover({
      name: "createPolicy",
      method: "POST",
      path: "/api/policies",
      description:
        "Multi-recipient USDC split rules (JSON or natural language). Returns reusable policyId.",
      body: {
        text: "Split 60% to vitalik.eth and 40% to 0x…",
        name: "team-payroll",
        recipients: [{ address: "0x…", bps: 6000 }],
      },
    });
  }

  try {
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const policies = await listPolicies(limit);
    return jsonOk({
      policies: policies.map((policy) => ({
        policyId: policy.id,
        name: policy.name,
        recipients: policy.recipients,
        createdAt: policy.createdAt,
        updatedAt: policy.updatedAt,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

const bodySchema = z
  .object({
    /** Plain English split instructions (uses Anthropic) */
    text: z.string().min(1).max(4000).optional(),
    name: z.string().min(1).max(120).optional(),
    recipients: z
      .array(
        z.object({
          /** 0x, ENS (*.eth), or Base name (*.base.eth) */
          address: z.string(),
          bps: z.number().int(),
          label: z.string().max(64).optional(),
        }),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .refine((b) => Boolean(b.text?.trim()) || Boolean(b.recipients?.length), {
    message: "Provide text (plain English) or recipients[]",
  });

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    const interpreted = await interpretPolicyFromInput({
      text: body.text,
      name: body.name,
      recipients: body.recipients,
    });

    const policy = await createPolicy({
      name: interpreted.name,
      recipients: interpreted.recipients,
    });

    return jsonOk(
      {
        policyId: policy.id,
        name: policy.name,
        recipients: policy.recipients,
        source: interpreted.source,
        resolvedFrom: interpreted.resolvedFrom,
        createdAt: policy.createdAt,
      },
      201,
    );
  } catch (err) {
    return jsonError(err);
  }
}
