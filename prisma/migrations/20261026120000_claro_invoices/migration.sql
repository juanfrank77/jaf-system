
-- CreateTable
CREATE TABLE "ClaroInvoice" (
    "id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "claroPoId" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "workMonth" TEXT NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "ivu4" DECIMAL(65,30) NOT NULL,
    "ivu115" DECIMAL(65,30) NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "filePath" TEXT NOT NULL,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "madeById" TEXT NOT NULL,
    "loadedAt" TIMESTAMP(3),
    "loadedById" TEXT,
    "dueDate" TIMESTAMP(3),

    CONSTRAINT "ClaroInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClaroInvoice_seq_key" ON "ClaroInvoice"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "ClaroInvoice_claroPoId_key" ON "ClaroInvoice"("claroPoId");

-- CreateIndex
CREATE INDEX "ClaroInvoice_docId_idx" ON "ClaroInvoice"("docId");

-- CreateIndex
CREATE INDEX "ClaroInvoice_loadedAt_idx" ON "ClaroInvoice"("loadedAt");

-- AddForeignKey
ALTER TABLE "ClaroInvoice" ADD CONSTRAINT "ClaroInvoice_claroPoId_fkey" FOREIGN KEY ("claroPoId") REFERENCES "ClaroPo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaroInvoice" ADD CONSTRAINT "ClaroInvoice_docId_fkey" FOREIGN KEY ("docId") REFERENCES "jaf_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaroInvoice" ADD CONSTRAINT "ClaroInvoice_madeById_fkey" FOREIGN KEY ("madeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaroInvoice" ADD CONSTRAINT "ClaroInvoice_loadedById_fkey" FOREIGN KEY ("loadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

