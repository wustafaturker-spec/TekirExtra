CREATE TABLE "panel_widget_tercihleri" (
    "tenant_id" UUID NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "surum" INTEGER NOT NULL,
    "widgetlar" JSONB NOT NULL,
    PRIMARY KEY ("tenant_id", "user_id")
);

ALTER TABLE "panel_widget_tercihleri" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_widget_tercihleri" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_widget_tercihleri"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND "user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
