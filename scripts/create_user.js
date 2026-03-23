import { createUser, listUsers } from "../db.js";

function usage() {
  console.log(`Usage: node scripts/create_user.js --firstName <first> --lastName <last> --password <pwd> [--rent <rent>] [--balance <balance>] [--arrears <arrears>]`);
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key || !value) break;
  args[key.replace(/^--/, "")] = value;
}

if (!args.firstName || !args.password) {
  usage();
}

const user = createUser({
  first_name: args.firstName,
  last_name: args.lastName || "",
  account_number: args.password,
  rent: args.rent || "0",
  account_balance: args.balance || "0",
  arrears: args.arrears || "0",
});

console.log("Created user:", {
  id: user.id,
  tenant_id: user.tenant_id,
  first_name: user.first_name,
  last_name: user.last_name,
});

console.log("Current users:", listUsers().map((u) => ({ id: u.id, tenant_id: u.tenant_id, first_name: u.first_name, last_name: u.last_name })));
