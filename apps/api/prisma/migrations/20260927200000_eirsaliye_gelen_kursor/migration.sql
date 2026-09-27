-- EBLG-109: gelen e-İrsaliye taramasının son çalıştığı an; periyodik tarama aralığı buna bakar.
ALTER TABLE "ebelge_gelen_kursor" ADD COLUMN "irsaliye_son_cekim_at" TIMESTAMP(3);
