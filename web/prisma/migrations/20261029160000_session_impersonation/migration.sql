-- Platform admins' "Log in as": the admin who opened an impersonation session.
ALTER TABLE "Session" ADD COLUMN "impersonatedBy" TEXT;
