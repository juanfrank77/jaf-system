-- AlterTable
ALTER TABLE "ServiceCode" ADD COLUMN     "equipment" BOOLEAN NOT NULL DEFAULT false;

-- The 13 Claro equipment service numbers (Digger, Truck Bomm, Truck Barreno).
-- unitPrice is what JAF invoices Claro; contractorPrice is the brigade's 80%.
-- A number the catalog already holds is only tagged, never repriced.
INSERT INTO "ServiceCode" ("id", "claroCode", "name", "kind", "unit", "unitPrice", "contractorPrice", "equipment")
SELECT v."id", v."claroCode", v."name", 'SERVICE'::"CatalogKind", v."unit", v."unitPrice", v."contractorPrice", true
FROM (VALUES
  ('equip_34007042', '34007042', 'DIGGER Equipment', 'Full day', 500, 400),
  ('equip_34006172', '34006172', 'DIGGER Equipment', 'Full day', 500, 400),
  ('equip_34005914', '34005914', 'DIGGER Equipment', 'Full day', 500, 400),
  ('equip_34013800', '34013800', 'DIGGER Equipment', 'Half day', 250, 200),
  ('equip_34007051', '34007051', 'DIGGER Equipment', 'Half day', 250, 200),
  ('equip_34013801', '34013801', 'DIGGER Equipment', 'Half day', 250, 200),
  ('equip_34014138', '34014138', 'DIGGER Equipment', 'Out of business hours', 800, 640),
  ('equip_34009677', '34009677', 'TRUCK BOMM Equipment', 'Flat', 250, 200),
  ('equip_34009321', '34009321', 'TRUCK BOMM Equipment', 'Flat', 250, 200),
  ('equip_34009322', '34009322', 'TRUCK BOMM Equipment', 'Flat', 250, 200),
  ('equip_34009678', '34009678', 'TRUCK BOMM Equipment', 'Flat', 250, 200),
  ('equip_34009323', '34009323', 'TRUCK BARRENO Equipment', 'Flat', 700, 560),
  ('equip_34009324', '34009324', 'TRUCK BARRENO Equipment', 'Flat', 700, 560)
) AS v("id", "claroCode", "name", "unit", "unitPrice", "contractorPrice")
ON CONFLICT ("claroCode") DO UPDATE SET "equipment" = true;
