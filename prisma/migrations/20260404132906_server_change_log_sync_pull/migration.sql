-- CreateTable
CREATE TABLE "ServerChangeLog" (
    "serverVersion" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "storeScopeId" TEXT,

    CONSTRAINT "ServerChangeLog_pkey" PRIMARY KEY ("serverVersion")
);

-- CreateIndex
CREATE INDEX "ServerChangeLog_storeScopeId_idx" ON "ServerChangeLog"("storeScopeId");
