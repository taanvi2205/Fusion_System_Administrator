from .settings import *

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
        # Dummy values to satisfy _get_db_config keys
        "USER": "user",
        "PASSWORD": "password",
        "HOST": "localhost",
        "PORT": "5432",
    }
}
