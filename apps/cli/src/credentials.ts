export interface CredentialStore {
  get(reference: string): Promise<string | undefined>;
  set(reference: string, secret: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();
  async get(reference: string): Promise<string | undefined> { return this.values.get(reference); }
  async set(reference: string, secret: string): Promise<void> { this.values.set(reference, secret); }
  async delete(reference: string): Promise<void> { this.values.delete(reference); }
}

export function credentialReference(providerId: string): string {
  const safeId = providerId.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (!safeId) throw new Error('Provider ID is required for credential storage.');
  return `moderado/provider/${safeId}`;
}

export async function resolveCredential(environment: string | undefined, reference: string | undefined, legacy: string | undefined, store: CredentialStore): Promise<string | undefined> {
  if (environment?.trim()) return environment.trim();
  if (reference) {
    const stored = await store.get(reference);
    if (stored?.trim()) return stored;
  }
  return legacy?.trim() || undefined;
}
