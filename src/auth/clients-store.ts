/**
 * Drizzle-backed implementation of the MCP SDK's
 * {@link OAuthRegisteredClientsStore} interface.
 *
 * The SDK contract is framework-agnostic: `getClient(clientId)` and
 * `registerClient(metadata)` return SDK-shaped `OAuthClientInformationFull`
 * values (snake_case, RFC 7591). This file is the only place that translates
 * between the SDK shape and the camelCase Drizzle schema.
 *
 * Every mutation writes an audit row in the same transaction — see
 * `src/auth/audit.ts` for the rationale.
 *
 * Schema: `src/db/schema/auth.ts#oauthClients`.
 */

import { eq } from 'drizzle-orm';

import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';

import type { Db } from '../db.ts';
import { oauthClients } from '../db/schema/auth.ts';
import { writeAuditEvent, type AuditContext } from './audit.ts';

type OauthClientRow = typeof oauthClients.$inferSelect;

function rowToClient(row: OauthClientRow): OAuthClientInformationFull {
  return {
    client_id: row.clientId,
    client_id_issued_at: Math.floor(row.clientIdIssuedAt.getTime() / 1000),
    redirect_uris: row.redirectUris as [string, ...string[]],
    client_name: row.clientName ?? undefined,
    grant_types: row.grantTypes ?? undefined,
    response_types: row.responseTypes ?? undefined,
    token_endpoint_auth_method: row.tokenEndpointAuthMethod ?? undefined,
    scope: row.scope ?? undefined,
  } as OAuthClientInformationFull;
}

export class DrizzleClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly db: Db) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const rows = await this.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, clientId))
      .limit(1);
    const row = rows[0];
    return row ? rowToClient(row) : undefined;
  }

  /**
   * Register a new client. Takes the SDK shape (snake_case, no client_id) and
   * returns the full shape with generated `client_id` / `client_id_issued_at`.
   *
   * An audit row with `event_type = 'register'` is written in the same
   * transaction as the insert. `redirect_uris` validation matches the
   * previous hand-rolled implementation: the SDK schema already enforces
   * non-empty URL array at parse time, so we don't re-validate here.
   */
  async registerClient(
    metadata: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
    context: AuditContext = {},
  ): Promise<OAuthClientInformationFull> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(oauthClients)
        .values({
          redirectUris: metadata.redirect_uris as string[],
          clientName: metadata.client_name ?? null,
          grantTypes: metadata.grant_types ?? null,
          responseTypes: metadata.response_types ?? null,
          tokenEndpointAuthMethod: metadata.token_endpoint_auth_method ?? null,
          scope: metadata.scope ?? null,
        })
        .returning();

      const client = rowToClient(row);

      await writeAuditEvent(tx, {
        eventType: 'register',
        clientId: client.client_id,
        outcome: 'success',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          client_name: client.client_name ?? null,
          redirect_uris_count: client.redirect_uris.length,
        },
      });

      return client;
    });
  }
}
