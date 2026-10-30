output "turnstile_sitekey" {
  value = cloudflare_turnstile_widget.this.sitekey
}

output "web_analytics_site_token" {
  value = cloudflare_web_analytics_site.this.site_token
}

output "email_sending_subdomain_id" {
  value = cloudflare_email_sending_subdomain.this.id
}

output "placement" {
  value = {
    account_ids          = toset([cloudflare_turnstile_widget.this.account_id, cloudflare_web_analytics_site.this.account_id])
    zone_ids             = toset([cloudflare_email_sending_subdomain.this.zone_id])
    web_analytics_host   = cloudflare_web_analytics_site.this.host
    email_sending_domain = cloudflare_email_sending_subdomain.this.name
  }
}
