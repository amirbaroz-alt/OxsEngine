import { smsTemplateService } from "./services/sms-template.service";
import { authService } from "./services/auth.service";
import { log } from "./index";

export async function seedDatabase() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || "amir@baroz.co.il";
    await authService.seedSuperAdmin(adminEmail);

    await smsTemplateService.seedDefaults();

    log("Seed completed", "seed");
  } catch (error: any) {
    log(`Seed error: ${error.message}`, "seed");
  }
}
