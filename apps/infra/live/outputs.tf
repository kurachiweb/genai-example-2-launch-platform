output "resource_ids" {
  value = {
    d1                       = module.storage.database_ids
    turnstile_sitekey        = module.edge_services.turnstile_sitekey
    web_analytics_site_token = module.edge_services.web_analytics_site_token
  }
}
