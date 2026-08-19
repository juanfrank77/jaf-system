-- Rename DocStatus enum value to match the new LC terminology.
ALTER TYPE "DocStatus" RENAME VALUE 'LC_GENERATED' TO 'LC_REQUEST_GENERATED';
