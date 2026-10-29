output "turnstile_sitekey" {
  value = cloudflare_turnstile_widget.this.sitekey
}

output "web_analytics_site_token" {
  value = cloudflare_web_analytics_site.this.site_token
}

output "email_sending_subdomain_id" {
  value = cloudflare_email_sending_subdomain.this.id
}
