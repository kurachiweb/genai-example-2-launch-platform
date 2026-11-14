variable "environment" {
  type = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environmentは\"staging\"・\"prod\"のいずれかにする。"
  }
}

variable "state_passphrase" {
  type      = string
  sensitive = true
}

# 環境と食い違う資源一覧で計画が止まることを、実物の資源一覧を変えずにテストで確かめるため
variable "catalog_directory" {
  type    = string
  default = "../environments"
}
