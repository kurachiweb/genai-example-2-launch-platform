locals {
  catalog = jsondecode(file("${path.module}/../environments/${var.environment}.json"))

  turnstile = {
    name    = local.catalog.turnstile.name
    domains = local.catalog.turnstile.hostnames
    mode    = local.catalog.turnstile.mode
  }

  worker_domains = {
    for key, host in local.catalog.hostnames : key => {
      hostname = host.hostname
      service  = local.catalog.workers[host.worker].name
    }
  }
}

check "catalog_environment" {
  assert {
    condition     = local.catalog.environment == var.environment
    error_message = "資源一覧の環境(${local.catalog.environment})が変数environment(${var.environment})と一致しない。"
  }
}

module "storage" {
  source = "../modules/storage"

  account_id   = local.catalog.cloudflare.accountId
  jurisdiction = local.catalog.jurisdiction
  databases    = local.catalog.d1
  buckets      = local.catalog.r2
}

module "messaging" {
  source = "../modules/messaging"

  account_id   = local.catalog.cloudflare.accountId
  jurisdiction = local.catalog.jurisdiction
  queues       = local.catalog.queues
}

module "edge_services" {
  source = "../modules/edge-services"

  account_id           = local.catalog.cloudflare.accountId
  zone_id              = local.catalog.cloudflare.zoneId
  turnstile            = local.turnstile
  web_analytics_host   = local.catalog.webAnalytics.hostname
  email_sending_domain = local.catalog.emailSending.domain
}

module "worker_routing" {
  source = "../modules/worker-routing"

  account_id = local.catalog.cloudflare.accountId
  zone_id    = local.catalog.cloudflare.zoneId
  domains    = local.worker_domains
}
