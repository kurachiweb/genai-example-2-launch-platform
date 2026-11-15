output "resource_ids" {
  value = {
    d1                       = module.storage.database_ids
    turnstile_sitekey        = module.edge_services.turnstile_sitekey
    web_analytics_site_token = module.edge_services.web_analytics_site_token
  }

  # 別の環境の資源一覧で計画・適用しないよう、資源一覧の環境が変数environmentと食い違えば計画を止める
  precondition {
    condition     = local.catalog.environment == var.environment
    error_message = "資源一覧の環境(${local.catalog.environment})が変数environment(${var.environment})と一致しない。"
  }
}
