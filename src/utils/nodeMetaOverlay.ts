import type { AdminClient, NodeInfo } from "@/types/komari";
import {
  HOME_FACET_PROVIDER,
  HOME_FACET_PURPOSE,
  type HomeNodeFacets,
} from "@/utils/homeVpsViews";

function firstConfiguredFacet(
  facets: HomeNodeFacets,
  uuid: string,
  dimensionId: string,
) {
  return facets[uuid]?.[dimensionId]?.find((value) => value.trim())?.trim() ?? "";
}

/**
 * The official server deliberately has no provider/business-role columns.
 * Reuse the theme's existing per-node facet data as a non-destructive metadata
 * overlay so home filtering and list sorting agree on the same labels.
 */
export function overlayConfiguredNodeMeta(
  meta: NodeInfo,
  configuredFacets: HomeNodeFacets | undefined,
): NodeInfo {
  if (!configuredFacets) return meta;
  const provider = firstConfiguredFacet(configuredFacets, meta.uuid, HOME_FACET_PROVIDER);
  const businessRole = firstConfiguredFacet(configuredFacets, meta.uuid, HOME_FACET_PURPOSE);
  if (!provider && !businessRole) return meta;

  return {
    ...meta,
    // A backend-native value is authoritative. Facets fill only fields that
    // upstream does not model, preserving the legacy fork's current behavior.
    provider: meta.provider?.trim() || provider,
    business_role: meta.business_role?.trim() || businessRole,
  };
}

export function overlayAdminClientMeta(
  meta: NodeInfo,
  adminClient: AdminClient | undefined,
): NodeInfo {
  if (!adminClient) return meta;

  return {
    ...meta,
    version: adminClient.version,
    ipv4: adminClient.ipv4 || meta.ipv4,
    ipv6: adminClient.ipv6 || meta.ipv6,
    capability_ping: adminClient.capability_ping ?? meta.capability_ping,
    capability_private_ping_targets:
      adminClient.capability_private_ping_targets ??
      meta.capability_private_ping_targets,
  };
}

export function shouldIncludeAgentVersionCompleteness({
  loggedIn,
  adminMetadataReady,
}: {
  loggedIn: boolean;
  adminMetadataReady: boolean;
}) {
  return loggedIn && adminMetadataReady;
}
