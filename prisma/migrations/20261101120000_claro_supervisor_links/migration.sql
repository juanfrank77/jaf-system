-- CreateTable
CREATE TABLE "_SupervisorClaroLinks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SupervisorClaroLinks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_SupervisorClaroLinks_B_index" ON "_SupervisorClaroLinks"("B");

-- AddForeignKey
ALTER TABLE "_SupervisorClaroLinks" ADD CONSTRAINT "_SupervisorClaroLinks_A_fkey" FOREIGN KEY ("A") REFERENCES "ClaroSupervisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SupervisorClaroLinks" ADD CONSTRAINT "_SupervisorClaroLinks_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

