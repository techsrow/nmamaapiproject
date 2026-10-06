import cron from "node-cron";
import { syncShiprocketShipments } from "../services/syncShiprocketShipment";

export function startShipmentCron() {
  cron.schedule("0 */4 * * *", async () => {
    console.log("🔄 Running shipment sync cron...");
    await syncShiprocketShipments();
  });
}
