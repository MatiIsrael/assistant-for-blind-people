from django.db import models

class NavigationSession(models.Model):
    session_id = models.CharField(max_length=100, unique=True)
    language = models.CharField(max_length=20, default='en')
    destination = models.CharField(max_length=255)
    category = models.CharField(max_length=100, default='place')
    meters_walked = models.IntegerField(default=0)
    distance_remaining = models.IntegerField(default=100)
    target_distance = models.IntegerField(default=100)
    status = models.CharField(max_length=50, default='active')  # active, arrived, cancelled
    hazards_encountered = models.IntegerField(default=0)
    current_lat = models.FloatField(default=9.0108)  # Default: Addis Ababa (Meskel Square)
    current_lng = models.FloatField(default=38.7613)
    dest_lat = models.FloatField(default=9.0180)
    dest_lng = models.FloatField(default=38.7680)
    speed_mps = models.FloatField(default=1.2)
    battery_level = models.IntegerField(default=95)
    last_user_speech = models.CharField(max_length=500, blank=True, default='')
    last_assistant_speech = models.CharField(max_length=500, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.session_id} - {self.destination} ({self.language})"


class HazardLog(models.Model):
    session = models.ForeignKey(NavigationSession, related_name='hazards', on_delete=models.CASCADE, null=True, blank=True)
    hazard_type = models.CharField(max_length=100)
    distance_meters = models.FloatField(default=2.0)
    direction = models.CharField(max_length=50, default='center')  # left, center, right
    description = models.TextField(blank=True)
    lat = models.FloatField(default=9.0108)
    lng = models.FloatField(default=38.7613)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Hazard {self.hazard_type} ({self.direction}) at {self.distance_meters}m"


class CaregiverAlert(models.Model):
    session = models.ForeignKey(NavigationSession, related_name='alerts', on_delete=models.CASCADE, null=True, blank=True)
    message = models.CharField(max_length=255)
    alert_type = models.CharField(max_length=50, default='info')  # info, warning, emergency_sos
    is_delivered = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"[{self.alert_type}] {self.message}"

