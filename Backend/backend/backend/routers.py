class SystemDBRouter:
    route_app_labels = {'django_apscheduler'}
    system_models = {'backuprecord', 'restorerecord', 'backupschedule', 'healthcheck'}

    def db_for_read(self, model, **hints):
        if model._meta.app_label in self.route_app_labels or model._meta.model_name.lower() in self.system_models:
            return 'system_db'
        return None

    def db_for_write(self, model, **hints):
        if model._meta.app_label in self.route_app_labels or model._meta.model_name.lower() in self.system_models:
            return 'system_db'
        return None

    def allow_relation(self, obj1, obj2, **hints):
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label in self.route_app_labels or (model_name and model_name.lower() in self.system_models):
            return db == 'system_db'
        
        if db == 'system_db':
            return False

        return None
