import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

// Engine modules harus murni: tanpa Supabase, React, atau Next.
// Ini menegakkan prinsip arsitektur "ENGINE = TypeScript murni" (docs/phase-0/02).
const enginePaths = [
  "src/lib/config/**/*.ts",
  "src/lib/scheduler/**/*.ts",
  "src/lib/validation/**/*.ts",
  "src/lib/simulator/**/*.ts",
  "src/lib/payroll/**/*.ts",
];

const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "coverage/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: enginePaths,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*", "react", "react-dom", "next", "next/*"],
              message:
                "Modul engine harus murni (tanpa Supabase/React/Next). Kirim data lewat parameter.",
            },
            {
              group: ["@/lib/supabase/*", "@/lib/auth/*", "@/server/*"],
              message: "Engine tidak boleh bergantung pada lapisan infrastruktur.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
