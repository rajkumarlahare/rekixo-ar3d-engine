export declare const RESERVED_PROJECT_SLUGS: readonly string[];

export declare function normalizeProjectSlug(
  value: string | null | undefined,
): string;

export declare function validProjectSlug(
  value: string | null | undefined,
): boolean;
