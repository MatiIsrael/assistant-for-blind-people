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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.session_id} - {self.destination} ({self.language})"
