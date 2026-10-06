import { prisma } from "../src/lib/prisma";
import bcrypt from "bcrypt";

async function main() {
  const adminEmail = "admin@mysticsmoke.com";
  const adminPassword = "Admin@123";

  // check if admin already exists
  const existing = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existing) {
    console.log("⚠️ Admin already exists");
    return;
  }

  const hashed = await bcrypt.hash(adminPassword, 10);

  await prisma.user.create({
    data: {
      firstName: "Admin",
      lastName: "User",
      email: adminEmail,
      passwordHash: hashed,
      role: "Admin",
    },
  });

  console.log("✅ Admin created successfully:");
  console.log(`Email: ${adminEmail}`);
  console.log(`Password: ${adminPassword}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
