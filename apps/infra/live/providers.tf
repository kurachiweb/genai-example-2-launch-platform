provider "infisical" {
  host = local.catalog.infisical.host
}

ephemeral "infisical_secret" "cloudflare_api_token" {
  name         = "CLOUDFLARE_API_TOKEN"
  env_slug     = var.environment
  workspace_id = local.catalog.infisical.projectId
  folder_path  = "/ci/cloudflare"
}

provider "cloudflare" {
  api_token = ephemeral.infisical_secret.cloudflare_api_token.value
}
