resource "cloudflare_turnstile_widget" "this" {
  account_id = var.account_id
  name       = var.turnstile.name
  domains    = var.turnstile.domains
  mode       = var.turnstile.mode
  region     = "world"

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_web_analytics_site" "this" {
  account_id   = var.account_id
  host         = var.web_analytics_host
  auto_install = false
}

resource "cloudflare_email_sending_subdomain" "this" {
  zone_id                    = var.zone_id
  name                       = var.email_sending_domain
  preview_enabled            = false
  drop_suppressed_recipients = false
}
