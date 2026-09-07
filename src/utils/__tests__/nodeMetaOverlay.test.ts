import { describe, expect, it } from "vitest";
import type { AdminClient, NodeInfo } from "@/types/komari";
import {
  overlayAdminClientMeta,
  overlayConfiguredNodeMeta,
  shouldIncludeAgentVersionCompleteness,
} from "@/utils/nodeMetaOverlay";

function meta(partial: Partial<NodeInfo> = {}): NodeInfo {
  return {
    uuid: "node-a",
    name: "Node A",
    group: "prod",
    region: "HK",
    hidden: false,
    cpu_name: "",
    cpu_cores: 1,
    arch: "amd64",
    virtualization: "",
    os: "linux",
    kernel_version: "",
    version: "",
    ipv4: "",
    ipv6: "",
    capability_ping: null,
    capability_private_ping_targets: null,
    gpu_name: "",
    mem_total: 0,
    swap_total: 0,
    disk_total: 0,
    weight: 0,
    price: 0,
    billing_cycle: "",
    auto_renewal: false,
    currency: "USD",
    expired_at: "",
    tags: "",
    public_remark: "",
    traffic_limit: 0,
    traffic_limit_type: "max",
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

function admin(partial: Partial<AdminClient> = {}): AdminClient {
  return {
    uuid: "node-a",
    name: "Node A",
    group: "prod",
    region: "HK",
    weight: 0,
    version: "v1.2.6",
    ipv4: "203.0.113.10",
    ipv6: "2001:db8::10",
    capability_ping: true,
    capability_private_ping_targets: false,
    ...partial,
  };
}

describe("overlayAdminClientMeta", () => {
  it("keeps public metadata unchanged without admin data", () => {
    const publicMeta = meta();

    expect(overlayAdminClientMeta(publicMeta, undefined)).toBe(publicMeta);
  });

  it("overlays authenticated agent version and capability metadata", () => {
    const enriched = overlayAdminClientMeta(meta(), admin());

    expect(enriched.version).toBe("v1.2.6");
    expect(enriched.ipv4).toBe("203.0.113.10");
    expect(enriched.capability_ping).toBe(true);
  });
});

describe("overlayConfiguredNodeMeta", () => {
  it("uses configured provider and purpose facets only when upstream fields are absent", () => {
    const configured = overlayConfiguredNodeMeta(meta({ provider: "", business_role: "" }), {
      "node-a": {
        provider: ["DMIT"],
        purpose: ["落地"],
      },
    });
    expect(configured.provider).toBe("DMIT");
    expect(configured.business_role).toBe("落地");

    const native = overlayConfiguredNodeMeta(meta({ provider: "Native", business_role: "原生" }), {
      "node-a": {
        provider: ["DMIT"],
        purpose: ["落地"],
      },
    });
    expect(native.provider).toBe("Native");
    expect(native.business_role).toBe("原生");
  });
});

describe("shouldIncludeAgentVersionCompleteness", () => {
  it("requires authenticated admin metadata before checking agent version", () => {
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: false,
        adminMetadataReady: true,
      }),
    ).toBe(false);
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: true,
        adminMetadataReady: false,
      }),
    ).toBe(false);
    expect(
      shouldIncludeAgentVersionCompleteness({
        loggedIn: true,
        adminMetadataReady: true,
      }),
    ).toBe(true);
  });
});
