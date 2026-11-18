import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "node_modules/**", "supabase/functions/**", "preview-dist/**"] }];

export default config;
